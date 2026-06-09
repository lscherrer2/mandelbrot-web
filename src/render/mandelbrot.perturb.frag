#version 300 es
precision highp float;

// Tier C — deep-zoom Mandelbrot via perturbation theory.
//
// A single high-precision reference orbit Z_n (anchored at the view center) is
// computed on the CPU and uploaded as an RG32F texture. Each pixel tracks only
// its small deviation δ_n = z_n − Z_n with the recurrence
//     δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc        (δc = c − C = pixelOffset · span)
// which keeps the working numbers in hardware-float range — solving the
// *precision* wall. To also survive the *exponent* wall (δ ≈ 1e-300 underflows
// float32, δ² ≈ 1e-600 underflows even float64), δ is stored as a mantissa/exp
// pair  δ = d · 2^exp  with |d| renormalized to O(1) and `exp` a per-pixel
// float. Zhuoran rebasing keeps a single reference glitch-free.

uniform vec2  uResolution;
uniform float uSpanMant;     // span = uSpanMant · 2^uSpanExp, uSpanMant ∈ [1,2)
uniform float uSpanExp;
uniform vec2  uPixelBias;    // (viewCenter − anchor)/span, lets small pans skip orbit recompute
uniform int   uMaxIter;      // true iteration cap
uniform sampler2D uRefOrbit; // RG32F, texel n = Z_n (Re,Im)
uniform int   uRefW;         // reference texture width
uniform int   uMaxRefIter;   // last valid reference index (rebase wraps at this)

uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform float uScale;
uniform float uOffset;
uniform int   uSmooth;
uniform int   uMode;

out vec4 fragColor;

const float R2 = 65536.0; // bailout² (R = 256, large → smooth coloring)

vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 fetchZ(int m) {
    return texelFetch(uRefOrbit, ivec2(m % uRefW, m / uRefW), 0).rg;
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

vec3 hsv2rgb(vec3 h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h.x * 6.0, 6.0);
    return h.z - h.z * h.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;

    // δc = (pixelOffset + panBias) · span, as a mantissa (O(1)) with exponent
    // uSpanExp. The bias absorbs panning away from the reference anchor.
    vec2  dcMant = (p + uPixelBias) * uSpanMant;
    float se     = uSpanExp;

    // δ = d · 2^exp.  Start at δ₀ = 0, exponent seeded to the span scale so the
    // first δc add is not flushed to zero.
    vec2  d   = vec2(0.0);
    float ex  = se;
    int   m   = 0;
    int   esc = -1;
    float zz  = 0.0;

    for (int iter = 0; iter < uMaxIter; iter++) {
        vec2 Z = fetchZ(m);

        // Reconstruct true orbit z = Z_m + δ. `scaled` = δ as a plain float
        // (valid while ex > −126; underflows to 0 only at extreme depth → z ≈ Z).
        vec2 scaled = d * exp2(ex);
        vec2 z = Z + scaled;
        zz = dot(z, z);
        if (zz > R2) { esc = iter; break; }

        // Rebase (Zhuoran): when the running orbit |z| drops below |δ| (glitch
        // onset) or the reference is exhausted, fold z back into δ and restart
        // the reference. Compare in L∞ (max-abs) — NOT |z|²/|δ|², whose squares
        // underflow float32 at depth and silently disable the glitch correction.
        float zmag = max(abs(z.x), abs(z.y));
        float dmag = max(abs(scaled.x), abs(scaled.y));
        if (zmag < dmag || m >= uMaxRefIter) {
            d = z; ex = 0.0; renorm(d, ex);
            m = 0;
            Z = vec2(0.0); // Z₀ = 0
        }

        // Step δ' = 2·Z·δ + δ² + δc, combined at exponent Ep = max(ex, se) so
        // every scale factor is ≤ 1 (terms that underflow are correctly dropped).
        vec2  a  = 2.0 * cmul(Z, d);  // exponent ex
        vec2  b  = cmul(d, d);        // exponent 2·ex
        float Ep = max(ex, se);
        d = a      * exp2(ex - Ep)
          + b      * exp2(2.0 * ex - Ep)
          + dcMant * exp2(se - Ep);
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

    vec3 col;
    if (l < 0.0) {
        col = vec3(0.0);
    } else if (uMode == 1) {
        col = 0.5 + 0.5 * cos(3.0 + l * 0.15 * uScale + uOffset * 6.2831853
                              + vec3(0.0, 0.6, 1.0) + uHue * 6.2831853);
    } else {
        col = hsv2rgb(vec3(uHue + l * 0.05 * uScale + uOffset, uSat, uVal));
    }
    fragColor = vec4(col, 1.0);
}
