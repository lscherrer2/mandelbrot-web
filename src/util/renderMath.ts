export const BASE_SPAN = 4.0
export const MIN_ZOOM = -5
// Deep-zoom ceiling. The Tier C perturbation renderer resolves down to ~1e-300;
// 2^1000 ≈ 1e301 ⇒ span ≈ 4e-301, comfortably inside double's exponent range.
export const MAX_ZOOM = 1000

export type Viewport = { cx: number; cy: number; span: number }

// Absolute floor on viewport.span, matched to MAX_ZOOM.
export const MIN_SPAN = BASE_SPAN / Math.pow(2, MAX_ZOOM)

// Span at/above which the plain float32 direct shader (Tier A) still resolves
// pixels — its precision wall is ~1e-4. Below this we switch to Tier C
// (perturbation). A hysteresis band (handled by the caller) avoids flicker.
export const TIER_DIRECT_MIN_SPAN = 2e-4

export type Tier = "direct" | "perturb"

/** Which renderer to use for a given span (no hysteresis — caller adds that). */
export function pickTier(span: number): Tier {
  return span >= TIER_DIRECT_MIN_SPAN ? "direct" : "perturb"
}

export function clampSpan(span: number): number {
  return Math.max(MIN_SPAN, span)
}

/**
 * Split a (possibly sub-float32) span into mantissa ∈ [1,2) and integer base-2
 * exponent, so the Tier C shader can carry δc = pixelOffset·span past the
 * float32 underflow threshold (~1e-38).
 */
export function spanMantExp(span: number): { mant: number; exp: number } {
  if (!(span > 0)) return { mant: 1, exp: 0 }
  const exp = Math.floor(Math.log2(span))
  const mant = span / Math.pow(2, exp)
  return { mant, exp }
}

/**
 * Logical zoom level, computed from viewport span. Negative = zoomed out past
 * the base view. Used for the iteration ramp and the sidebar readout.
 */
export function pickZoom(viewportSpan: number): number {
  if (viewportSpan <= 0) return MAX_ZOOM
  const z = Math.floor(Math.log2(BASE_SPAN / viewportSpan))
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

// Past this zoom level, escape iterations stop resolving detail unless we
// scale them with depth. Deep (Tier C) zooms need far more — the ramp keeps
// climbing and the cap is high (this also sets the reference-orbit length).
const ITER_RAMP_ZOOM = 12
const ITER_PER_ZOOM = 160
// Deep (Tier C) locations need iterations growing faster than linearly with
// zoom depth — minibrots near the boundary escape slowly, so a linear ramp
// reads as solid black at depth. The quadratic term keeps headroom climbing.
const ITER_QUAD_PER_ZOOM = 0.75
// The quadratic ramp reaches ~890k at MAX_ZOOM; a 100k cap would saturate at
// span ~1e-86 and starve everything deeper. Renders stay responsive because
// the deep tier is budgeted/progressive, not because iterations are few.
const MAX_EFFECTIVE_ITER = 1000000
// Flat headroom on the base count so low/medium zooms (0-5) resolve a bit more
// detail. The depth ramp above stacks on top of this scaled base.
const ITER_BASE_SCALE = 1.35

export function effectiveIterations(baseIter: number, span: number): number {
  const zoom = pickZoom(span)
  const d = Math.max(0, zoom - ITER_RAMP_ZOOM)
  const extra = d * ITER_PER_ZOOM + d * d * ITER_QUAD_PER_ZOOM
  return Math.min(MAX_EFFECTIVE_ITER, Math.round(baseIter * ITER_BASE_SCALE) + Math.round(extra))
}

// Depth-adaptive palette compression. Deeper views escape at ever-higher
// iteration counts (the ramp above), so a fixed color scale cycles faster and
// faster — bands get visually denser with zoom. Shrinking the effective scale
// as the iteration budget grows keeps band frequency roughly steady. The
// exponent < 1 makes the compensation partial ("slight"); 1 would fully
// flatten deep views.
const DEPTH_SCALE_EXP = 0.5

export function depthScaleFactor(baseIter: number, span: number): number {
  const base = effectiveIterations(baseIter, BASE_SPAN)
  const eff = effectiveIterations(baseIter, span)
  return Math.pow(base / eff, DEPTH_SCALE_EXP)
}

/** Convert a screen-pixel coordinate to a complex-plane coordinate. */
export function screenToComplex(
  sx: number,
  sy: number,
  viewport: Viewport,
  vw: number,
  vh: number,
): { x: number; y: number } {
  const pxPerUnit = vw / viewport.span
  return {
    x: viewport.cx + (sx - vw / 2) / pxPerUnit,
    y: viewport.cy - (sy - vh / 2) / pxPerUnit,
  }
}

/** Zoom by `factor` (>1 = in) keeping screen point (sx,sy) fixed in complex coords. */
export function zoomAt(
  v: Viewport,
  sx: number,
  sy: number,
  vw: number,
  vh: number,
  factor: number,
): Viewport {
  const pxPerUnit = vw / v.span
  const px = v.cx + (sx - vw / 2) / pxPerUnit
  const py = v.cy - (sy - vh / 2) / pxPerUnit
  const newSpan = clampSpan(v.span / factor)
  const newPxPerUnit = vw / newSpan
  return {
    cx: px - (sx - vw / 2) / newPxPerUnit,
    cy: py + (sy - vh / 2) / newPxPerUnit,
    span: newSpan,
  }
}
