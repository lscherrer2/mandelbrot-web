import { useGesture } from "@use-gesture/react"
import { useEffect, useRef } from "react"

import { useStore } from "../state/store"
import { zoomAt, type Viewport } from "../util/renderMath"

/**
 * Invisible div that sits on top of the tile layer and catches pinch / drag
 * / wheel input. Writes the new viewport to the store and asks the pipeline
 * for a new render (debounced).
 *
 * No React state is held here; gesture handlers read/write the store directly.
 */
export function GestureSurface() {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  // Suppress browser pinch-zoom of the page itself. @use-gesture's
  // `eventOptions.passive: false` handles this for the wheel/pinch events
  // it owns, but Safari's gesturestart still needs an explicit block.
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

  const applyViewport = (next: Viewport) => {
    useStore.getState().setViewport(next)
  }

  useGesture(
    {
      onDrag: ({ delta: [dx, dy], pinching }) => {
        if (pinching) return
        const el = surfaceRef.current
        if (!el) return
        const vw = el.clientWidth
        const v = useStore.getState().viewport
        const pxPerUnit = vw / v.span
        // Drag-down (dy > 0) reveals what was above on screen, which is
        // higher complex-y under the math convention — so cy INCREASES.
        applyViewport({
          ...v,
          cx: v.cx - dx / pxPerUnit,
          cy: v.cy + dy / pxPerUnit,
        })
      },
      onPinch: ({ origin: [ox, oy], offset: [scale], memo }) => {
        const el = surfaceRef.current
        if (!el) return memo
        const rect = el.getBoundingClientRect()
        const sx = ox - rect.left
        const sy = oy - rect.top
        const prevScale = (memo as number | undefined) ?? scale
        if (prevScale > 0 && scale > 0 && scale !== prevScale) {
          const factor = scale / prevScale
          const v = useStore.getState().viewport
          applyViewport(zoomAt(v, sx, sy, rect.width, rect.height, factor))
        }
        return scale
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
        const v = useStore.getState().viewport
        applyViewport(zoomAt(v, sx, sy, rect.width, rect.height, factor))
      },
    },
    {
      target: surfaceRef,
      eventOptions: { passive: false },
      drag: { filterTaps: true, pointer: { keys: false } },
      pinch: { scaleBounds: { min: 0.001, max: 1e15 }, rubberband: false },
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
