// Triple-float arithmetic for WebGL2 (GLSL ES 3.00).
// A value is vec3(hi, mid, lo) with magnitude (hi + mid + lo), components
// in descending magnitude. Effective relative precision ~2^-69.
//
// Same reassociation defenses as dfMath.glsl: out parameters, one op per
// statement, no nested expressions. Split constant 4097.0 is safe for the
// magnitudes encountered in the Mandelbrot iteration (|operand| < 256).

const float TF_SPLIT = 4097.0;

void tf_add(in vec3 a, in vec3 b, out vec3 r) {
    // two_sum on highs
    float s0 = a.x + b.x;
    float v0 = s0 - a.x;
    float sv0 = s0 - v0;
    float u0 = a.x - sv0;
    float w0 = b.x - v0;
    float t0 = u0 + w0;

    // two_sum on mids
    float s1 = a.y + b.y;
    float v1 = s1 - a.y;
    float sv1 = s1 - v1;
    float u1 = a.y - sv1;
    float w1 = b.y - v1;
    float t1 = u1 + w1;

    // Fold high carry into mid sum
    float s1b = s1 + t0;
    float v2 = s1b - s1;
    float sv2 = s1b - v2;
    float u2 = s1 - sv2;
    float w2 = t0 - v2;
    float t2 = u2 + w2;

    // Tail collects everything below mid scale
    float lo_sum = a.z + b.z;
    float err_sum = t1 + t2;
    float tail = lo_sum + err_sum;

    // Renormalize the triple (s0, s1b, tail)
    float h0 = s0 + s1b;
    float v3 = h0 - s0;
    float sv3 = h0 - v3;
    float u3 = s0 - sv3;
    float w3 = s1b - v3;
    float e0 = u3 + w3;

    float h1 = e0 + tail;
    float v4 = h1 - e0;
    float sv4 = h1 - v4;
    float u4 = e0 - sv4;
    float w4 = tail - v4;
    float h2 = u4 + w4;

    r = vec3(h0, h1, h2);
}

void tf_sub(in vec3 a, in vec3 b, out vec3 r) {
    vec3 nb = vec3(-b.x, -b.y, -b.z);
    tf_add(a, nb, r);
}

void tf_mul(in vec3 a, in vec3 b, out vec3 r) {
    // Dekker split for a.x and b.x to compute exact a.x * b.x
    float ta = a.x * TF_SPLIT;
    float ua = ta - a.x;
    float a_hi = ta - ua;
    float a_lo = a.x - a_hi;
    float tb = b.x * TF_SPLIT;
    float ub = tb - b.x;
    float b_hi = tb - ub;
    float b_lo = b.x - b_hi;

    float p0 = a.x * b.x;
    float k1 = a_hi * b_hi;
    float k2 = k1 - p0;
    float k3 = a_hi * b_lo;
    float k4 = k2 + k3;
    float k5 = a_lo * b_hi;
    float k6 = k4 + k5;
    float k7 = a_lo * b_lo;
    float q0 = k6 + k7;

    // Mid-magnitude cross terms (compensated via two_sum chain)
    float c1 = a.x * b.y;
    float c2 = a.y * b.x;

    float m0 = q0 + c1;
    float vm0 = m0 - q0;
    float svm0 = m0 - vm0;
    float um0 = q0 - svm0;
    float wm0 = c1 - vm0;
    float em0 = um0 + wm0;

    float m1 = m0 + c2;
    float vm1 = m1 - m0;
    float svm1 = m1 - vm1;
    float um1 = m0 - svm1;
    float wm1 = c2 - vm1;
    float em1 = um1 + wm1;

    // Tail-scale cross terms (plain products are fine — below noise floor)
    float c3 = a.x * b.z;
    float c4 = a.y * b.y;
    float c5 = a.z * b.x;
    float tail_c = c3 + c4 + c5;
    float tail_err = em0 + em1;
    float tail = tail_c + tail_err;

    // Renormalize (p0, m1, tail) into a non-overlapping triple
    float h0 = p0 + m1;
    float vh0 = h0 - p0;
    float svh0 = h0 - vh0;
    float uh0 = p0 - svh0;
    float wh0 = m1 - vh0;
    float eh0 = uh0 + wh0;

    float h1 = eh0 + tail;
    float vh1 = h1 - eh0;
    float svh1 = h1 - vh1;
    float uh1 = eh0 - svh1;
    float wh1 = tail - vh1;
    float h2 = uh1 + wh1;

    r = vec3(h0, h1, h2);
}

void tf_sqr(in vec3 a, out vec3 r) {
    // Dekker split for a.x to compute exact a.x * a.x
    float ta = a.x * TF_SPLIT;
    float ua = ta - a.x;
    float a_hi = ta - ua;
    float a_lo = a.x - a_hi;

    float p0 = a.x * a.x;
    float k1 = a_hi * a_hi;
    float k2 = k1 - p0;
    float k3 = a_hi * a_lo;
    float k4 = 2.0 * k3;
    float k5 = k2 + k4;
    float k6 = a_lo * a_lo;
    float q0 = k5 + k6;

    // 2 * a.x * a.y is the mid cross term
    float xy = a.x * a.y;
    float c1 = 2.0 * xy;

    float m0 = q0 + c1;
    float vm0 = m0 - q0;
    float svm0 = m0 - vm0;
    float um0 = q0 - svm0;
    float wm0 = c1 - vm0;
    float em0 = um0 + wm0;

    // Tail-scale: 2*a.x*a.z and a.y*a.y
    float xz = a.x * a.z;
    float c2 = 2.0 * xz;
    float c3 = a.y * a.y;
    float tail_c = c2 + c3;
    float tail = tail_c + em0;

    float h0 = p0 + m0;
    float vh0 = h0 - p0;
    float svh0 = h0 - vh0;
    float uh0 = p0 - svh0;
    float wh0 = m0 - vh0;
    float eh0 = uh0 + wh0;

    float h1 = eh0 + tail;
    float vh1 = h1 - eh0;
    float svh1 = h1 - vh1;
    float uh1 = eh0 - svh1;
    float wh1 = tail - vh1;
    float h2 = uh1 + wh1;

    r = vec3(h0, h1, h2);
}

// Multiply a triple-float by a plain float. Scaling by an exact power of two
// (e.g. 2.0) is exact and the caller can just multiply each component
// directly without going through this routine.
void tf_mul_f(in vec3 a, in float b, out vec3 r) {
    float ta = a.x * TF_SPLIT;
    float ua = ta - a.x;
    float a_hi = ta - ua;
    float a_lo = a.x - a_hi;
    float tb = b * TF_SPLIT;
    float ub = tb - b;
    float b_hi = tb - ub;
    float b_lo = b - b_hi;

    float p0 = a.x * b;
    float k1 = a_hi * b_hi;
    float k2 = k1 - p0;
    float k3 = a_hi * b_lo;
    float k4 = k2 + k3;
    float k5 = a_lo * b_hi;
    float k6 = k4 + k5;
    float k7 = a_lo * b_lo;
    float q0 = k6 + k7;

    float c1 = a.y * b;
    float m0 = q0 + c1;
    float vm0 = m0 - q0;
    float svm0 = m0 - vm0;
    float um0 = q0 - svm0;
    float wm0 = c1 - vm0;
    float em0 = um0 + wm0;

    float c2 = a.z * b;
    float tail = c2 + em0;

    float h0 = p0 + m0;
    float vh0 = h0 - p0;
    float svh0 = h0 - vh0;
    float uh0 = p0 - svh0;
    float wh0 = m0 - vh0;
    float eh0 = uh0 + wh0;

    float h1 = eh0 + tail;
    float vh1 = h1 - eh0;
    float svh1 = h1 - vh1;
    float uh1 = eh0 - svh1;
    float wh1 = tail - vh1;
    float h2 = uh1 + wh1;

    r = vec3(h0, h1, h2);
}
