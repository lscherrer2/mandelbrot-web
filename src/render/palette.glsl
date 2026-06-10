// Shared coloring for the fractal shaders: shade(l) maps a (smooth) escape
// count to a color. Interior points (l < 0) are handled by the callers.
// glRenderer splices this file into each fragment shader in place of the
// `//#include palette.glsl` marker, so both tiers color identically.
//
// Mode indices must match COLOR_MODES in src/state/hash.ts.

uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform float uScale;
uniform float uOffset;
uniform float uRelief; // 0 = off, 1 = full "3D" slope shading
uniform int   uMode;

const float TAU = 6.2831853;

vec3 hsv2rgb(vec3 h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h.x * 6.0, 6.0);
    return h.z - h.z * h.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}

// The canonical Ultra Fractal / Wikipedia gradient: deep blue → azure →
// white → orange → near-black, as a wrapping piecewise-linear ramp.
vec3 gradClassic(float t) {
    const vec3 c0 = vec3(0.000, 0.027, 0.392);
    const vec3 c1 = vec3(0.125, 0.420, 0.796);
    const vec3 c2 = vec3(0.929, 1.000, 1.000);
    const vec3 c3 = vec3(1.000, 0.667, 0.000);
    const vec3 c4 = vec3(0.000, 0.008, 0.000);
    if (t < 0.16)   return mix(c0, c1, t / 0.16);
    if (t < 0.42)   return mix(c1, c2, (t - 0.16) / 0.26);
    if (t < 0.6425) return mix(c2, c3, (t - 0.42) / 0.2225);
    if (t < 0.8575) return mix(c3, c4, (t - 0.6425) / 0.215);
    return mix(c4, c0, (t - 0.8575) / 0.1425);
}

// Black-body ramp: ember red → orange → yellow → white heat. t ∈ [0,1].
vec3 gradEmber(float t) {
    const vec3 c0 = vec3(0.02, 0.00, 0.00);
    const vec3 c1 = vec3(0.55, 0.06, 0.00);
    const vec3 c2 = vec3(1.00, 0.45, 0.00);
    const vec3 c3 = vec3(1.00, 0.85, 0.25);
    const vec3 c4 = vec3(1.00, 1.00, 0.92);
    if (t < 0.30) return mix(c0, c1, t / 0.30);
    if (t < 0.60) return mix(c1, c2, (t - 0.30) / 0.30);
    if (t < 0.85) return mix(c2, c3, (t - 0.60) / 0.25);
    return mix(c3, c4, (t - 0.85) / 0.15);
}

// Abyss → deep blue → azure → cyan → foam. t ∈ [0,1].
vec3 gradOcean(float t) {
    const vec3 c0 = vec3(0.01, 0.02, 0.09);
    const vec3 c1 = vec3(0.00, 0.18, 0.45);
    const vec3 c2 = vec3(0.00, 0.50, 0.75);
    const vec3 c3 = vec3(0.25, 0.85, 0.85);
    const vec3 c4 = vec3(0.92, 1.00, 1.00);
    if (t < 0.30) return mix(c0, c1, t / 0.30);
    if (t < 0.60) return mix(c1, c2, (t - 0.30) / 0.30);
    if (t < 0.85) return mix(c2, c3, (t - 0.60) / 0.25);
    return mix(c3, c4, (t - 0.85) / 0.15);
}

// --- Relief ("slope") shading ----------------------------------------------
// The smooth iteration count is a heightfield h; its gradient follows
// analytically from der = dz/dc at escape:
//     ∇h ∥ z·conj(der),   |∇h| = |der| / (|z| · ln|z| · ln 2)
// Both are exactly invariant under one more iteration (z→z², der→2·z·der), so
// the shading is seamless across iteration bands. Keeping the MAGNITUDE is
// what separates flat plateaus from steep "spikes" — normalizing it away
// degenerates into a binary-decomposition checkerboard.
// Lambert-lighting the surface normal (−∇h·px, 1) gives the embossed look.
//
// |der| (~1/span at depth) overflows float32, so callers pass its mantissa
// plus an explicit power-of-two exponent (derExp), and log2Px = log2 of the
// pixel size in complex units; only log2 totals are ever combined.

const vec3  RELIEF_L3   = normalize(vec3(-0.60, 0.60, 0.55)); // upper-left light
const float RELIEF_GAIN = 12.0; // vertical exaggeration at slider = 1

// Lambert term t ∈ [0,1]; flat ground gives t = RELIEF_L3.z.
float reliefT(vec2 z, vec2 der, float derExp, float log2Px) {
    float dm = max(abs(der.x), abs(der.y));
    if (!(dm > 0.0)) return RELIEF_L3.z; // degenerate derivative → flat
    vec2 dn = der / dm;                  // prescale so z·conj(der) can't overflow
    vec2 u  = vec2(z.x * dn.x + z.y * dn.y,
                   z.y * dn.x - z.x * dn.y); // z·conj(der): uphill of log|z|
    float ul = length(u);
    if (!(ul > 0.0)) return RELIEF_L3.z;
    float zz  = dot(z, z);
    float lnz = 0.34657359 * log2(zz);   // ln|z|
    // |∇h| per *pixel*, in log2: the huge derExp cancels against log2Px.
    float logg = log2(dm) + derExp + log2Px
               - 0.5 * log2(zz) - log2(lnz * 0.6931472);
    float strength = uRelief * uRelief; // finer control at small slider values
    float g = exp2(clamp(logg, -30.0, 30.0)) * RELIEF_GAIN * strength;
    vec3 n = normalize(vec3((u / ul) * g, 1.0)); // heightfield surface normal
    return max(dot(n, RELIEF_L3), 0.0);
}

// t→color: plateaus (t = L3.z) keep the palette color untouched; lit slopes
// brighten and shadowed ones darken without crushing the palette to black.
vec3 applyRelief(vec3 col, float t) {
    float flatLight = RELIEF_L3.z;
    float lit = max(t - flatLight, 0.0) / (1.0 - flatLight);
    float shadow = max(flatLight - t, 0.0) / flatLight;
    float factor = 1.0 + 0.65 * lit - 0.50 * shadow;
    float sheen = 0.10 * pow(smoothstep(flatLight, 1.0, t), 8.0);
    return col * factor + vec3(sheen);
}

vec3 shade(float l) {
    float x = l * uScale; // position along the color ramp

    if (uMode == 0) { // Rainbow — plain HSV cycling (original profile)
        return hsv2rgb(vec3(uHue + x * 0.05 + uOffset, uSat, uVal));
    }
    if (uMode == 1) { // Cosmic — IQ cosine palette (original profile)
        return 0.5 + 0.5 * cos(3.0 + x * 0.15 + uOffset * TAU
                               + vec3(0.0, 0.6, 1.0) + uHue * TAU);
    }
    if (uMode == 2) { // Classic — hue/offset rotate the gradient phase
        return gradClassic(fract(x * 0.02 + uHue + uOffset));
    }
    if (uMode == 3) { // Ember — ping-pong the ramp so it never seams
        float t = 1.0 - abs(2.0 * fract(x * 0.02 + uHue + uOffset) - 1.0);
        return gradEmber(t);
    }
    if (uMode == 4) { // Ocean — same ping-pong trick
        float t = 1.0 - abs(2.0 * fract(x * 0.02 + uHue + uOffset) - 1.0);
        return gradOcean(t);
    }
    if (uMode == 5) { // Pearl — silvery bands washed with slate blue / dusty rose
        float band = 0.5 + 0.5 * cos(TAU * (x * 0.05 + uOffset));
        band = pow(band, 1.4); // metallic contrast
        float wash = 0.5 + 0.5 * cos(TAU * (x * 0.011 + uHue)); // slow color drift
        vec3 tint = mix(vec3(0.52, 0.56, 0.74), vec3(0.72, 0.50, 0.52), wash);
        return band * mix(tint, vec3(1.0), band * band) + vec3(0.03);
    }
    if (uMode == 6) { // Zebra — crisp alternating bands, smoothed for AA
        float s = fract(x * 0.05 + uOffset);
        float b = smoothstep(0.0, 0.08, s) - smoothstep(0.5, 0.58, s);
        vec3 tint = hsv2rgb(vec3(uHue, 0.25 * uSat, 1.0));
        return mix(vec3(0.03), tint, b);
    }
    if (uMode == 7) { // Neon — dark field, electric band cores that bloom white
        float t = fract(x * 0.04 + uOffset);
        float g = pow(0.5 + 0.5 * cos(TAU * t), 6.0);
        vec3 base = hsv2rgb(vec3(uHue + 0.07 * sin(TAU * x * 0.008), max(uSat, 0.85), 1.0));
        return base * (0.05 + 0.95 * g) + vec3(0.55) * pow(g, 3.0);
    }
    if (uMode == 9) { // Clay — near-flat warm matte, made for Relief shading
        float wash = 0.5 + 0.5 * cos(TAU * (x * 0.02 + uOffset));
        return hsv2rgb(vec3(uHue, (0.30 + 0.10 * wash) * uSat, 0.60 + 0.08 * wash));
    }
    // Aurora — flowing emerald / teal / violet curtains (cosine palette)
    float t = x * 0.03 + uOffset + uHue;
    return vec3(0.25, 0.45, 0.40)
         + vec3(0.35, 0.45, 0.42) * cos(TAU * (t + vec3(0.60, 0.32, 0.10)));
}
