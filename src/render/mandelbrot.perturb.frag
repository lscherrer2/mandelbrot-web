#version 300 es
precision highp float;

// Tier C — deep-zoom Mandelbrot via perturbation theory, in extended-range
// ("floatexp") arithmetic end to end.
//
// A single high-precision reference orbit Z_n (anchored at the view center) is
// computed on the CPU and uploaded as an RGBA32F texture, each texel packing
// Z_n = mant·2^exp. Each pixel tracks only its small deviation δ_n = z_n − Z_n
// with the recurrence
//     δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc        (δc = c − C = pixelOffset · span)
// — solving the *precision* wall. To also survive the *exponent* wall, every
// magnitude-carrying quantity is a mantissa/exponent pair: δ = d·2^ex, the
// reference Z (whose close returns near a depth-1e-300 minibrot are ~1e-150,
// far below float32's ~1e-38 flush threshold), and the reassembled full orbit
// z = Z + δ = zm·2^zE. The escape test and Zhuoran rebasing comparison are
// done on those pairs, so they stay exact at any depth — plain-float
// reconstruction is used only where the value is provably in float32 range
// (escape happens at |z| ≈ 256).

uniform vec2  uResolution;
uniform float uSpanMant;     // span = uSpanMant · 2^uSpanExp, uSpanMant ∈ [1,2)
uniform float uSpanExp;
uniform vec2  uPixelBias;    // (viewCenter − anchor)/span, lets small pans skip orbit recompute
uniform int   uMaxIter;      // true iteration cap
uniform sampler2D uRefOrbit; // RGBA32F, texel n = (mantRe, mantIm, exp, 0) of Z_n
uniform int   uRefW;         // reference texture width
uniform int   uMaxRefIter;   // last valid reference index (rebase wraps at this)

uniform int   uSmooth;

out vec4 fragColor;

//#include palette.glsl

const float R2 = 65536.0; // bailout² (R = 256, large → smooth coloring)
// Exponent of an exact-zero orbit point (worker writes this sentinel); any
// exponent this small flushes the term to zero at every scale it meets.
const float E_ZERO = -1.0e9;

vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec3 fetchZ(int m) {
    return texelFetch(uRefOrbit, ivec2(m % uRefW, m / uRefW), 0).rgb;
}

// 2^e for the (always ≤ 0) exponent-alignment factors. Clamped so the sentinel
// exponent can't feed exp2 a huge argument (driver-safe; anything below −200
// underflows float32 to the intended 0 anyway).
float pexp2(float e) {
    return exp2(max(e, -200.0));
}

// Renormalize a mantissa/exponent pair so |d| (L∞) lands in [1,2).
void renorm(inout vec2 d, inout float e) {
    float mag = max(abs(d.x), abs(d.y));
    if (mag > 0.0) {
        float k = clamp(floor(log2(mag)), -126.0, 126.0);
        d *= exp2(-k);
        e += k;
    }
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;

    // δc = (pixelOffset + panBias) · span, as a mantissa (O(1)) with exponent
    // uSpanExp. The bias absorbs panning away from the reference anchor.
    vec2  dcMant = (p + uPixelBias) * uSpanMant;
    float se     = uSpanExp;

    // δ = d · 2^ex.  Start at δ₀ = 0, exponent seeded to the span scale so the
    // first δc add lands at the right magnitude.
    vec2  d   = vec2(0.0);
    float ex  = se;
    int   m   = 0;
    int   esc = -1;
    float zz  = 0.0;
    vec2  zEsc = vec2(0.0);
    vec2  der    = vec2(0.0); // dz/dc as mantissa·2^derExp (see relief note)
    float derExp = 0.0;

    for (int iter = 0; iter < uMaxIter; iter++) {
        vec3  Zt = fetchZ(m);
        vec2  Zm = Zt.xy;
        float Ze = Zt.z;

        // Reconstruct the true orbit z = Z + δ, aligned at the larger
        // exponent. A side more than ~2^126 below the other flushes out of the
        // sum — correctly negligible. Renorm puts max|zm| in [1,2).
        float zE = max(Ze, ex);
        vec2  zm = Zm * pexp2(Ze - zE) + d * pexp2(ex - zE);
        renorm(zm, zE);

        // Escape test on a plain-float reconstruction: |z| stays ≤ ~2^18 (one
        // step past the bailout), so float32 covers every possible escape;
        // below 2^-120 the orbit is simply tiny and cannot escape.
        vec2 zf = zE > -120.0 ? zm * exp2(zE) : vec2(0.0);
        zz = dot(zf, zf);
        if (zz > R2) { esc = iter; zEsc = zf; break; }

        // Relief shading needs der = dz/dc via der' = 2·z·der + 1, using the
        // reconstructed z (rebasing doesn't touch it). The true |der| at depth
        // is ~1/span — far beyond float32 — so it is carried as mantissa·2^derExp
        // and the step is combined in exponent form: the 2·z·der term lives at
        // zE+derExp+1, the +1 term at exponent 0. reliefT cancels derExp
        // against log2(pixel size).
        if (uRelief > 0.0) {
            float eA = zE + derExp + 1.0;
            float eN = max(eA, 0.0);
            der = cmul(zm, der) * pexp2(eA - eN) + vec2(pexp2(-eN), 0.0);
            derExp = eN;
            renorm(der, derExp);
        }

        // Rebase (Zhuoran): when the running orbit |z| drops below |δ| (glitch
        // onset) or the reference is exhausted, fold z back into δ and restart
        // the reference. Both sides are renormalized mantissa·2^exp, so the
        // exponent-then-mantissa comparison is exact at any depth — this is
        // what plain-float comparison silently got wrong below ~1e-38.
        float zMagM = max(abs(zm.x), abs(zm.y));
        float dMagM = max(abs(d.x), abs(d.y));
        bool zSmaller = zMagM == 0.0
            ? dMagM > 0.0
            : (zE < ex || (zE == ex && zMagM < dMagM));
        if (zSmaller || m >= uMaxRefIter) {
            d = zm; ex = zE;
            m = 0;
            Zm = vec2(0.0); Ze = E_ZERO; // Z₀ = 0
        }

        // Step δ' = 2·Z·δ + δ² + δc with each term as mantissa·2^exp, combined
        // at the largest exponent Ep so every scale factor is ≤ 1 (terms that
        // underflow sit ≥ 2^126 below the leading one — correctly dropped).
        vec2  a  = cmul(Zm, d);       // ·2^eA, the 2· folded into the exponent
        float eA = Ze + ex + 1.0;
        vec2  b  = cmul(d, d);        // ·2^eB
        float eB = ex + ex;
        float Ep = max(max(eA, eB), se);
        d = a      * pexp2(eA - Ep)
          + b      * pexp2(eB - Ep)
          + dcMant * pexp2(se - Ep);
        ex = Ep;
        renorm(d, ex);
        m++;
    }

    float l;
    if (esc < 0) {
        l = -1.0; // hit iteration cap → interior
    } else if (uSmooth != 0) {
        l = float(esc) - log2(log2(zz)) + 4.0;
    } else {
        l = float(esc);
    }

    vec3 col = vec3(0.0);
    if (l >= 0.0) {
        col = shade(l);
        if (uRelief > 0.0) {
            float log2Px = uSpanExp + log2(uSpanMant) - log2(uResolution.x);
            col = applyRelief(col, reliefT(zEsc, der, derExp, log2Px));
        }
    }
    fragColor = vec4(col, 1.0);
}
