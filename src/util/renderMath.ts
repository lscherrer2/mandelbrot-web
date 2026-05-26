export const BASE_SPAN = 4.0
export const MIN_ZOOM = -5
export const MAX_ZOOM = 60

export type Viewport = { cx: number; cy: number; span: number }

export type PrecisionTier = "f32" | "df" | "tf"

// Trigger thresholds engage a higher tier; release thresholds drop back.
// Gap between trigger and release gives hysteresis so tiny zoom jitter near
// the boundary doesn't thrash the program switch.
export const DF_SPAN_TRIGGER = 1e-4
export const DF_SPAN_RELEASE = 1.5e-4
export const TF_SPAN_TRIGGER = 2e-11
export const TF_SPAN_RELEASE = 3e-11

export function nextPrecisionTier(current: PrecisionTier, spanX: number): PrecisionTier {
  // Step at most one tier per call so the release check on the way out has
  // a chance to apply if the user zooms out across multiple thresholds.
  if (spanX < TF_SPAN_TRIGGER) return "tf"
  if (current === "tf" && spanX < TF_SPAN_RELEASE) return "tf"
  if (spanX < DF_SPAN_TRIGGER) return "df"
  if (current === "df" && spanX < DF_SPAN_RELEASE) return "df"
  return "f32"
}

// Split a float64 into two float32s whose sum equals the original to within
// the float32 round-off of the residual. `lo` carries the bits the float32
// `hi` had to discard, giving ~2^-46 effective relative precision.
export function splitDF(x: number): [hi: number, lo: number] {
  const hi = Math.fround(x)
  const lo = Math.fround(x - hi)
  return [hi, lo]
}

// Three float32s in descending magnitude. Effective precision ~2^-69, enough
// to keep per-pixel detail at MAX_ZOOM (span ~ 3.5e-18 / width ~ 2.3e-21).
export function splitTF(x: number): [hi: number, mid: number, lo: number] {
  const hi = Math.fround(x)
  const r1 = x - hi
  const mid = Math.fround(r1)
  const lo = Math.fround(r1 - mid)
  return [hi, mid, lo]
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
// scale them with depth.
const ITER_RAMP_ZOOM = 12
const ITER_PER_ZOOM = 64
const MAX_EFFECTIVE_ITER = 16384

export function effectiveIterations(baseIter: number, span: number): number {
  const zoom = pickZoom(span)
  const extra = Math.max(0, zoom - ITER_RAMP_ZOOM) * ITER_PER_ZOOM
  return Math.min(MAX_EFFECTIVE_ITER, baseIter + extra)
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
  const newSpan = v.span / factor
  const newPxPerUnit = vw / newSpan
  return {
    cx: px - (sx - vw / 2) / newPxPerUnit,
    cy: py + (sy - vh / 2) / newPxPerUnit,
    span: newSpan,
  }
}
