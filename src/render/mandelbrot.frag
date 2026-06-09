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
// On escape, zOut and derOut·2^derExpOut hold z and dz/dc for relief shading
// (see palette.glsl); the explicit exponent keeps |der| from overflowing.
float mandelbrot(vec2 c, int maxIter, out vec2 zOut, out vec2 derOut,
                 out float derExpOut) {
    zOut = vec2(0.0);
    derOut = vec2(0.0);
    derExpOut = 0.0;

    // Main-cardioid + period-2 bulb early-out.
    float c2 = dot(c, c);
    if (256.0*c2*c2 - 96.0*c2 + 32.0*c.x - 3.0 < 0.0) return -1.0;
    if (16.0*(c2 + 2.0*c.x + 1.0) - 1.0 < 0.0)        return -1.0;

    const float B = 256.0;
    vec2 z = vec2(0.0);
    vec2 der = vec2(0.0);
    float derExp = 0.0;
    float n = 0.0;
    for (int i = 0; i < maxIter; i++) {
        if (uRelief > 0.0) {
            // der' = 2·z·der + 1, with the magnitude carried as mantissa·2^exp
            // (the +1 is below float eps long before the rescale threshold,
            // so dropping it from the rescaled mantissa is exact anyway).
            der = 2.0 * vec2(z.x*der.x - z.y*der.y, z.x*der.y + z.y*der.x)
                + vec2(1.0, 0.0);
            if (max(abs(der.x), abs(der.y)) > 1.1e12) { // 2^40
                der *= exp2(-40.0);
                derExp += 40.0;
            }
        }
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        if (dot(z, z) > B*B) {
            zOut = z;
            derOut = der;
            derExpOut = derExp;
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
    float derExp;
    float l = mandelbrot(c, uMaxIter, z, der, derExp);
    vec3 col = vec3(0.0);
    if (l >= 0.0) {
        col = shade(l);
        if (uRelief > 0.0) {
            float log2Px = log2(uSpanX / uResolution.x);
            col = applyRelief(col, reliefT(z, der, derExp, log2Px));
        }
    }
    fragColor = vec4(col, 1.0);
}
