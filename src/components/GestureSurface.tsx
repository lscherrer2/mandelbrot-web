import { useGesture } from "@use-gesture/react"
import { useEffect, useRef } from "react"

import { useStore } from "../state/store"
import { BASE_SPAN, MIN_SPAN } from "../util/renderMath"

// Cumulative pinch scale needed to drive the view from BASE_SPAN down to the
// renderer's deep-zoom floor (MIN_SPAN ≈ 4e-301). @use-gesture clamps the pinch
// offset to scaleBounds, so this must reach the architecture's depth limit —
// otherwise pinch zoom stalls at a shallow wall and only a refresh (which resets
// the accumulator) lets you continue. The store's clampSpan enforces the real
// floor; this bound just keeps the input from capping short of it.
const MAX_PINCH_SCALE = BASE_SPAN / MIN_SPAN

/**
 * Invisible div that sits on top of the canvas and catches pinch / drag / wheel
 * input. Gesture handlers write to the store via delta-based actions
 * (panByPixels / zoomAtPixel) so the high-precision center stays exact even at
 * extreme zoom — the deltas are tiny but accumulate losslessly in fixed-point.
 */
export function GestureSurface() {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  // Suppress browser pinch-zoom of the page itself.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const block = (e: Event) => e.preventDefault()
    el.addEventListener("gesturestart", block)
    el.addEventListener("gesturechange", block)
    el.addEventListener("gestureend", block)
    return () => {
      el.removeEventListener("gesturestart", block)
      el.removeEventListener("gesturechange", block)
      el.removeEventListener("gestureend", block)
    }
  }, [])

  useGesture(
    {
      onDrag: ({ delta: [dx, dy], pinching }) => {
        if (pinching) return
        const el = surfaceRef.current
        if (!el) return
        useStore.getState().panByPixels(dx, dy, el.clientWidth)
      },
      onPinch: ({ origin: [ox, oy], offset: [scale], memo, first }) => {
        const el = surfaceRef.current
        if (!el) return memo
        const rect = el.getBoundingClientRect()
        const sx = ox - rect.left
        const sy = oy - rect.top
        const prev = memo as { scale: number; ox: number; oy: number } | undefined
        if (first || !prev) return { scale, ox, oy }

        const store = useStore.getState()
        // Zoom by the change in scale, anchored at the current centroid.
        if (prev.scale > 0 && scale > 0 && scale !== prev.scale) {
          store.zoomAtPixel(sx, sy, rect.width, rect.height, scale / prev.scale)
        }
        // Pan by centroid movement (two fingers translating while pinching).
        const dx = ox - prev.ox
        const dy = oy - prev.oy
        if (dx !== 0 || dy !== 0) {
          useStore.getState().panByPixels(dx, dy, rect.width)
        }
        return { scale, ox, oy }
      },
      onWheel: ({ event, delta: [, dy], pinching }) => {
        if (pinching) return
        const el = surfaceRef.current
        if (!el) return
        event.preventDefault()
        const rect = el.getBoundingClientRect()
        const sx = event.clientX - rect.left
        const sy = event.clientY - rect.top
        // Each notch is ~100px. Negative dy = scroll up = zoom in.
        const factor = Math.pow(1.2, -dy / 100)
        useStore.getState().zoomAtPixel(sx, sy, rect.width, rect.height, factor)
      },
    },
    {
      target: surfaceRef,
      eventOptions: { passive: false },
      drag: { filterTaps: true, pointer: { keys: false } },
      pinch: { scaleBounds: { min: 0.001, max: MAX_PINCH_SCALE }, rubberband: false },
    },
  )

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
    />
  )
}
