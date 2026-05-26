#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform vec2  uCenter;
uniform float uSpanX;
uniform int   uMaxIter;
uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform float uScale;
uniform float uOffset;

out vec4 fragColor;

// Returns smooth iteration count, or -1.0 for interior points.
float mandelbrot(vec2 c, int maxIter) {
    // Main-cardioid + period-2 bulb early-out.
    float c2 = dot(c, c);
    if (256.0*c2*c2 - 96.0*c2 + 32.0*c.x - 3.0 < 0.0) return -1.0;
    if (16.0*(c2 + 2.0*c.x + 1.0) - 1.0 < 0.0)        return -1.0;

    const float B = 256.0;
    vec2 z = vec2(0.0);
    float n = 0.0;
    for (int i = 0; i < maxIter; i++) {
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        if (dot(z, z) > B*B) {
            return n - log2(log2(dot(z, z))) + 4.0;
        }
        n += 1.0;
    }
    return -1.0;
}

vec3 hsv2rgb(vec3 h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h.x*6.0, 6.0);
    return h.z - h.z*h.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}

void main() {
    // GL gl_FragCoord.y=0 is the bottom of the framebuffer, which displays
    // at the bottom of the canvas. Our convention: higher complex-y points
    // upward on screen — so high gl_FragCoord.y → high c.y. No flip.
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;
    vec2 c = uCenter + p * uSpanX;
    float l = mandelbrot(c, uMaxIter);
    vec3 col = (l < 0.0)
        ? vec3(0.0)
        : hsv2rgb(vec3(uHue + l * 0.05 * uScale + uOffset, uSat, uVal));
    fragColor = vec4(col, 1.0);
}
