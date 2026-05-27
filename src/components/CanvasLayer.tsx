import { useEffect, useRef } from "react"

import { GLRenderer } from "../render/glRenderer"
import { useStore } from "../state/store"
import { effectiveIterations } from "../util/renderMath"

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
    const tick = () => {
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW > 0 && cssH > 0) {
        // 2x supersampling on top of the device pixel ratio, capped so we
        // don't melt phones at DPR=3. Most desktops land at 2 css px → 4
        // fragments; retina ends up at ~3.
        const SS = 2
        const dpr = window.devicePixelRatio || 1
        const ratio = Math.min(3, dpr * SS)
        const bw = Math.max(1, Math.floor(cssW * ratio))
        const bh = Math.max(1, Math.floor(cssH * ratio))
        renderer.resize(bw, bh)
        const { viewport, iterations, palette } = useStore.getState()
        renderer.render({
          cx: viewport.cx,
          cy: viewport.cy,
          spanX: viewport.span,
          width: bw,
          height: bh,
          iterations: effectiveIterations(iterations, viewport.span),
          palette,
        })
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
