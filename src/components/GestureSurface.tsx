import { useGesture } from "@use-gesture/react"
import { useEffect, useRef } from "react"

import { useStore } from "../state/store"
import { BASE_SPAN, MIN_SPAN } from "../util/renderMath"

// Pinch scales are only used as ratios inside a single gesture. Resetting the
// gesture offset to 1 avoids a stale cumulative scale hitting @use-gesture's
// bounds after several separate pinches. The bounds are intentionally huge so
// the input layer does not cap before the renderer's own zoom limits.
const MAX_PINCH_SCALE = BASE_SPAN / MIN_SPAN
const MIN_PINCH_SCALE = 1 / MAX_PINCH_SCALE

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
        const store = useStore.getState()
        if (store.panLocked) return
        store.panByPixels(dx, dy, el.clientWidth)
      },
      onPinch: ({ origin: [ox, oy], offset: [scale], memo, first }) => {
        const el = surfaceRef.current
        if (!el) return memo
        const rect = el.getBoundingClientRect()
        const prev = memo as { scale: number; ox: number; oy: number } | undefined
        if (first || !prev) return { scale, ox, oy }

        const store = useStore.getState()
        if (prev.scale > 0 && scale > 0 && scale !== prev.scale) {
          // When locked, zoom at screen center so the locked point never drifts.
          const sx = store.panLocked ? rect.width / 2 : ox - rect.left
          const sy = store.panLocked ? rect.height / 2 : oy - rect.top
          store.zoomAtPixel(sx, sy, rect.width, rect.height, scale / prev.scale)
        }
        if (!store.panLocked) {
          const dx = ox - prev.ox
          const dy = oy - prev.oy
          if (dx !== 0 || dy !== 0) store.panByPixels(dx, dy, rect.width)
        }
        return { scale, ox, oy }
      },
      onWheel: ({ event, delta: [, dy], pinching }) => {
        if (pinching) return
        const el = surfaceRef.current
        if (!el) return
        event.preventDefault()
        const rect = el.getBoundingClientRect()
        const store = useStore.getState()
        // When locked, zoom at screen center so the locked point stays centered.
        const sx = store.panLocked ? rect.width / 2 : event.clientX - rect.left
        const sy = store.panLocked ? rect.height / 2 : event.clientY - rect.top
        const factor = Math.pow(1.2, -dy / 100)
        store.zoomAtPixel(sx, sy, rect.width, rect.height, factor)
      },
    },
    {
      target: surfaceRef,
      eventOptions: { passive: false },
      drag: { filterTaps: true, pointer: { keys: false } },
      pinch: {
        from: () => [1, 0],
        scaleBounds: { min: MIN_PINCH_SCALE, max: MAX_PINCH_SCALE },
        rubberband: false,
      },
    },
  )

  const panLocked = useStore((s) => s.panLocked)

  return (
    <div
      ref={surfaceRef}
      className={`absolute inset-0 ${panLocked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      style={{ touchAction: "none" }}
    />
  )
}
