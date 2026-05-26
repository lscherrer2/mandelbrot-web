import { useEffect, useRef } from "react"

import { GLRenderer } from "../render/glRenderer"
import { useStore } from "../state/store"
import { type PrecisionTier, effectiveIterations } from "../util/renderMath"

/**
 * Single full-bleed canvas with a WebGL2 context that re-renders the
 * Mandelbrot set every animation frame using the current store state.
 * No debounce, no snapshot — the shader is cheap enough to draw at native
 * refresh rate.
 */
export function CanvasLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new GLRenderer(canvas)

    let raf = 0
    let lastTier: PrecisionTier = "f32"
    const tick = () => {
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW > 0 && cssH > 0) {
        // Cap DPR at 2 — 3x phones don't gain much for 2.25x fragment cost.
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const bw = Math.max(1, Math.floor(cssW * dpr))
        const bh = Math.max(1, Math.floor(cssH * dpr))
        renderer.resize(bw, bh)
        const { viewport, iterations, palette, setPrecisionTier } = useStore.getState()
        renderer.render({
          cx: viewport.cx,
          cy: viewport.cy,
          spanX: viewport.span,
          width: bw,
          height: bh,
          iterations: effectiveIterations(iterations, viewport.span),
          palette,
        })
        const tier = renderer.currentTier()
        if (tier !== lastTier) {
          lastTier = tier
          setPrecisionTier(tier)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full bg-zinc-950"
      style={{ display: "block" }}
    />
  )
}
