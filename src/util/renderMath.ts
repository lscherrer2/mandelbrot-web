export const BASE_SPAN = 4.0
export const MIN_ZOOM = -5
export const MAX_ZOOM = 18

export type Viewport = { cx: number; cy: number; span: number }

// Floor on viewport.span: anything smaller and the F32 shader stops resolving
// adjacent pixels. Picked to match MAX_ZOOM so the two limits stay in sync.
export const MIN_SPAN = BASE_SPAN / Math.pow(2, MAX_ZOOM)

export function clampSpan(span: number): number {
  return Math.max(MIN_SPAN, span)
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
  const newSpan = clampSpan(v.span / factor)
  const newPxPerUnit = vw / newSpan
  return {
    cx: px - (sx - vw / 2) / newPxPerUnit,
    cy: py + (sy - vh / 2) / newPxPerUnit,
    span: newSpan,
  }
}
