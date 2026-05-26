#version 300 es
precision highp float;

// @INCLUDE_DF_MATH

uniform vec2  uResolution;
uniform vec2  uCenterHi;
uniform vec2  uCenterLo;
uniform float uSpanXHi;
uniform float uSpanXLo;
uniform int   uMaxIter;
uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform float uScale;
uniform float uOffset;

out vec4 fragColor;

float mandelbrot_df(vec2 cx, vec2 cy, int maxIter) {
    // Cardioid + period-2 bulb early-out. Only catches points near the origin
    // where float32 is plenty — no need to spend df ops here.
    float fx = cx.x;
    float fy = cy.x;
    float c2 = fx*fx + fy*fy;
    if (256.0*c2*c2 - 96.0*c2 + 32.0*fx - 3.0 < 0.0) return -1.0;
    if (16.0*(c2 + 2.0*fx + 1.0) - 1.0 < 0.0)        return -1.0;

    const float B = 256.0;
    vec2 zx = vec2(0.0);
    vec2 zy = vec2(0.0);
    float n = 0.0;

    for (int i = 0; i < maxIter; i++) {
        vec2 zx2;
        df_sqr(zx, zx2);
        vec2 zy2;
        df_sqr(zy, zy2);

        float mag = zx2.x + zy2.x;
        if (mag > B*B) {
            return n - log2(log2(mag)) + 4.0;
        }

        vec2 diff;
        df_sub(zx2, zy2, diff);
        vec2 new_zx;
        df_add(diff, cx, new_zx);

        vec2 zxy;
        df_mul(zx, zy, zxy);
        vec2 zxy2 = vec2(2.0 * zxy.x, 2.0 * zxy.y);
        vec2 new_zy;
        df_add(zxy2, cy, new_zy);

        zx = new_zx;
        zy = new_zy;
        n += 1.0;
    }
    return -1.0;
}

vec3 hsv2rgb(vec3 h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h.x*6.0, 6.0);
    return h.z - h.z*h.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}

void main() {
    // Pixel offset in screen coordinates (|p| < ~1, float32 is fine here).
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;

    vec2 spanDF = vec2(uSpanXHi, uSpanXLo);

    vec2 dxDF;
    df_mul_f(spanDF, p.x, dxDF);
    vec2 dyDF;
    df_mul_f(spanDF, p.y, dyDF);

    vec2 cxCenter = vec2(uCenterHi.x, uCenterLo.x);
    vec2 cyCenter = vec2(uCenterHi.y, uCenterLo.y);

    vec2 cx;
    df_add(cxCenter, dxDF, cx);
    vec2 cy;
    df_add(cyCenter, dyDF, cy);

    float l = mandelbrot_df(cx, cy, uMaxIter);
    vec3 col = (l < 0.0)
        ? vec3(0.0)
        : hsv2rgb(vec3(uHue + l * 0.05 * uScale + uOffset, uSat, uVal));
    fragColor = vec4(col, 1.0);
}
