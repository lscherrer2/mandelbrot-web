#version 300 es
precision highp float;

// Presents the latest *finished* deep-tier frame (rendered offscreen) on the
// canvas, remapped from the viewport it was rendered at to the live viewport:
//   uScaleRatio = liveSpan / texSpan
//   uOffset     = (liveCenter − texCenter) / texSpan   (screen-normalized, y up)
// Keeping this pass trivially cheap is what decouples zoom/pan/sliders from
// the (much slower) perturbation render.

uniform vec2  uResolution; // canvas resolution
uniform sampler2D uTex;
uniform vec2  uTexSize;
uniform float uScaleRatio;
uniform vec2  uOffset;

out vec4 fragColor;

void main() {
    // Same screen-normalized convention as the fractal shaders: origin at
    // center, x ∈ [−0.5, 0.5], y up, both axes divided by width.
    vec2 q = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;
    vec2 pt = uOffset + q * uScaleRatio;
    vec2 uv = vec2(0.5) + pt * vec2(1.0, uTexSize.x / uTexSize.y);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
        fragColor = vec4(0.035, 0.035, 0.043, 1.0); // bg-zinc-950
        return;
    }
    fragColor = texture(uTex, uv);
}
