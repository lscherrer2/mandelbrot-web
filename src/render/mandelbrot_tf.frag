#version 300 es
precision highp float;

// @INCLUDE_TF_MATH

uniform vec2  uResolution;
uniform vec2  uCenterHi;
uniform vec2  uCenterMid;
uniform vec2  uCenterLo;
uniform float uSpanXHi;
uniform float uSpanXMid;
uniform float uSpanXLo;
uniform int   uMaxIter;
uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform float uScale;
uniform float uOffset;

out vec4 fragColor;

float mandelbrot_tf(vec3 cx, vec3 cy, int maxIter) {
    float fx = cx.x;
    float fy = cy.x;
    float c2 = fx*fx + fy*fy;
    if (256.0*c2*c2 - 96.0*c2 + 32.0*fx - 3.0 < 0.0) return -1.0;
    if (16.0*(c2 + 2.0*fx + 1.0) - 1.0 < 0.0)        return -1.0;

    const float B = 256.0;
    vec3 zx = vec3(0.0);
    vec3 zy = vec3(0.0);
    float n = 0.0;

    for (int i = 0; i < maxIter; i++) {
        vec3 zx2;
        tf_sqr(zx, zx2);
        vec3 zy2;
        tf_sqr(zy, zy2);

        float mag = zx2.x + zy2.x;
        if (mag > B*B) {
            return n - log2(log2(mag)) + 4.0;
        }

        vec3 diff;
        tf_sub(zx2, zy2, diff);
        vec3 new_zx;
        tf_add(diff, cx, new_zx);

        vec3 zxy;
        tf_mul(zx, zy, zxy);
        vec3 zxy2 = vec3(2.0 * zxy.x, 2.0 * zxy.y, 2.0 * zxy.z);
        vec3 new_zy;
        tf_add(zxy2, cy, new_zy);

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
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;

    vec3 spanTF = vec3(uSpanXHi, uSpanXMid, uSpanXLo);

    vec3 dxTF;
    tf_mul_f(spanTF, p.x, dxTF);
    vec3 dyTF;
    tf_mul_f(spanTF, p.y, dyTF);

    vec3 cxCenter = vec3(uCenterHi.x, uCenterMid.x, uCenterLo.x);
    vec3 cyCenter = vec3(uCenterHi.y, uCenterMid.y, uCenterLo.y);

    vec3 cx;
    tf_add(cxCenter, dxTF, cx);
    vec3 cy;
    tf_add(cyCenter, dyTF, cy);

    float l = mandelbrot_tf(cx, cy, uMaxIter);
    vec3 col = (l < 0.0)
        ? vec3(0.0)
        : hsv2rgb(vec3(uHue + l * 0.05 * uScale + uOffset, uSat, uVal));
    fragColor = vec4(col, 1.0);
}
