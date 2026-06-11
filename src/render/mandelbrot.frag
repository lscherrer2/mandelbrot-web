#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform vec2  uCenter;
uniform float uSpanX;
uniform int   uMaxIter;
uniform int   uSmooth;

out vec4 fragColor;

//#include palette.glsl

// Returns iteration count (smooth if uSmooth!=0), or -1.0 for interior points.
// On escape, zOut and derOut·2^derExpOut hold z and dz/dc for relief/edge
// shading (see palette.glsl); the explicit exponent keeps |der| from
// overflowing. stripeOut is the stripe-average texture value (0.5 when off).
float mandelbrot(vec2 c, int maxIter, out vec2 zOut, out vec2 derOut,
                 out float derExpOut, out float stripeOut) {
    zOut = vec2(0.0);
    derOut = vec2(0.0);
    derExpOut = 0.0;
    stripeOut = 0.5;

    // Main-cardioid + period-2 bulb early-out.
    float c2 = dot(c, c);
    if (256.0*c2*c2 - 96.0*c2 + 32.0*c.x - 3.0 < 0.0) return -1.0;
    if (16.0*(c2 + 2.0*c.x + 1.0) - 1.0 < 0.0)        return -1.0;

    const float B = 256.0;
    vec2 z = vec2(0.0);
    vec2 der = vec2(0.0);
    float derExp = 0.0;
    float n = 0.0;
    // Stripe-average accumulators (see palette.glsl). Two cutoffs keep the
    // texture out of float32 noise: (1) accumulation stops at a SMALL bailout
    // (|z| > 4, sFrac set at the crossing) — past it |dz/dc| has grown so
    // large that ulp-scale noise in c corrupts arg(z) by O(1); (2) at most
    // SACC_MAX early iterates are accumulated — in long orbits the trailing
    // ~dozens of iterates are corrupted the same way, and at high counts those
    // addends rival the whole signal, painting "tiers" along iteration bands.
    // The small-bailout fraction drives the Härkönen interpolation, keeping
    // the texture continuous across bands; the cap seam is continuous because
    // a crossing exactly at the cap interpolates to the plain capped average.
    const float SACC_MAX = 256.0;
    float sSum = 0.0;
    float sLast = 0.0;
    float sCnt = 0.0;
    float sFrac = -1.0; // < 0 while still accumulating
    for (int i = 0; i < maxIter; i++) {
        if (needDeriv()) {
            // der' = 2·z·der + 1, with the magnitude carried as mantissa·2^exp
            // (once rescaled, the +1 term must be expressed in mantissa units).
            der = 2.0 * vec2(z.x*der.x - z.y*der.y, z.x*der.y + z.y*der.x)
                + vec2(exp2(-derExp), 0.0);
            if (max(abs(der.x), abs(der.y)) > 1.1e12) { // 2^40
                der *= exp2(-40.0);
                derExp += 40.0;
            }
        }
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        if (uStripe > 0.0 && sFrac < 0.0 && sCnt < SACC_MAX) {
            sLast = 0.5 + 0.5 * sin(uStripeFreq * atan(z.y, z.x));
            sSum += sLast;
            sCnt += 1.0;
            float zz = dot(z, z);
            // Crossed the small bailout: u ∈ (0,1], 1 when |z| barely clears 4.
            if (zz > 16.0) sFrac = clamp(3.0 - log2(log2(zz)), 0.0, 1.0);
        }
        if (dot(z, z) > B*B) {
            zOut = z;
            derOut = der;
            derExpOut = derExp;
            if (uStripe > 0.0 && sCnt > 0.0) {
                if (sFrac >= 0.0) {
                    // Blend the averages with and without the crossing iterate
                    // by the small-bailout fraction so the texture is
                    // continuous across iteration bands.
                    float avgAll  = sSum / sCnt;
                    float avgPrev = sCnt > 1.0 ? (sSum - sLast) / (sCnt - 1.0) : avgAll;
                    stripeOut = mix(avgPrev, avgAll, sFrac);
                } else {
                    stripeOut = sSum / sCnt; // capped: early-orbit average only
                }
            }
            return (uSmooth != 0)
                ? n - log2(log2(dot(z, z))) + 4.0
                : n;
        }
        n += 1.0;
    }
    return -1.0;
}

void main() {
    // GL gl_FragCoord.y=0 is the bottom of the framebuffer, which displays
    // at the bottom of the canvas. Our convention: higher complex-y points
    // upward on screen — so high gl_FragCoord.y → high c.y. No flip.
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;
    vec2 c = uCenter + p * uSpanX;
    vec2 z, der;
    float derExp, stripe;
    float l = mandelbrot(c, uMaxIter, z, der, derExp, stripe);
    vec3 col = vec3(0.0);
    if (l >= 0.0) {
        float log2Px = log2(uSpanX / uResolution.x);
        col = colorize(l, stripe, z, der, derExp, log2Px);
    }
    fragColor = vec4(col, 1.0);
}
