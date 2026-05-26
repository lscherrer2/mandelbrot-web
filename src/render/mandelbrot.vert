#version 300 es

// Fullscreen triangle (oversized; clipped to viewport). No attribute buffer
// needed — positions derived from gl_VertexID. Draw with gl.drawArrays(TRIANGLES, 0, 3).
void main() {
    vec2 p = vec2(
        float((gl_VertexID & 1) << 2) - 1.0,
        float((gl_VertexID & 2) << 1) - 1.0
    );
    gl_Position = vec4(p, 0.0, 1.0);
}
