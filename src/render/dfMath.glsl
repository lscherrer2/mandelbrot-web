// Double-float arithmetic for WebGL2 (GLSL ES 3.00).
// A value is vec2(hi, lo) with magnitude (hi + lo) and |lo| < ulp(hi).
//
// Patterns chosen to deter compiler reassociation:
//   - out-parameter functions (compiler must honor the write contract)
//   - one float op per statement, each with its own named temporary
//   - no nested expressions inside error-compensation steps
//
// Dekker product splits with 4097.0 = 2^12 + 1; safe for |operand| < ~2^15
// which covers all values in the iteration (|z| < 256 at escape).

const float DF_SPLIT = 4097.0;

void df_add(in vec2 a, in vec2 b, out vec2 r) {
    float s = a.x + b.x;
    float v = s - a.x;
    float sv = s - v;
    float u = a.x - sv;
    float w = b.x - v;
    float e1 = u + w;
    float e2 = a.y + b.y;
    float e = e1 + e2;
    float rx = s + e;
    float dx = rx - s;
    float ry = e - dx;
    r = vec2(rx, ry);
}

void df_sub(in vec2 a, in vec2 b, out vec2 r) {
    vec2 nb = vec2(-b.x, -b.y);
    df_add(a, nb, r);
}

void df_mul(in vec2 a, in vec2 b, out vec2 r) {
    float ta = a.x * DF_SPLIT;
    float ua = ta - a.x;
    float a_hi = ta - ua;
    float a_lo = a.x - a_hi;
    float tb = b.x * DF_SPLIT;
    float ub = tb - b.x;
    float b_hi = tb - ub;
    float b_lo = b.x - b_hi;
    float p = a.x * b.x;
    float k1 = a_hi * b_hi;
    float k2 = k1 - p;
    float k3 = a_hi * b_lo;
    float k4 = k2 + k3;
    float k5 = a_lo * b_hi;
    float k6 = k4 + k5;
    float k7 = a_lo * b_lo;
    float e1 = k6 + k7;
    float c1 = a.x * b.y;
    float c2 = a.y * b.x;
    float cross = c1 + c2;
    float e = e1 + cross;
    float rx = p + e;
    float dx = rx - p;
    float ry = e - dx;
    r = vec2(rx, ry);
}

void df_sqr(in vec2 a, out vec2 r) {
    float ta = a.x * DF_SPLIT;
    float ua = ta - a.x;
    float a_hi = ta - ua;
    float a_lo = a.x - a_hi;
    float p = a.x * a.x;
    float k1 = a_hi * a_hi;
    float k2 = k1 - p;
    float k3 = a_hi * a_lo;
    float k4 = 2.0 * k3;
    float k5 = k2 + k4;
    float k6 = a_lo * a_lo;
    float e1 = k5 + k6;
    float c = 2.0 * a.x * a.y;
    float e = e1 + c;
    float rx = p + e;
    float dx = rx - p;
    float ry = e - dx;
    r = vec2(rx, ry);
}

void df_mul_f(in vec2 a, in float b, out vec2 r) {
    float ta = a.x * DF_SPLIT;
    float ua = ta - a.x;
    float a_hi = ta - ua;
    float a_lo = a.x - a_hi;
    float tb = b * DF_SPLIT;
    float ub = tb - b;
    float b_hi = tb - ub;
    float b_lo = b - b_hi;
    float p = a.x * b;
    float k1 = a_hi * b_hi;
    float k2 = k1 - p;
    float k3 = a_hi * b_lo;
    float k4 = k2 + k3;
    float k5 = a_lo * b_hi;
    float k6 = k4 + k5;
    float k7 = a_lo * b_lo;
    float e1 = k6 + k7;
    float cross = a.y * b;
    float e = e1 + cross;
    float rx = p + e;
    float dx = rx - p;
    float ry = e - dx;
    r = vec2(rx, ry);
}
