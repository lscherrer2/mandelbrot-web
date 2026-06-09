import { useEffect, useRef } from "react"

import { GLRenderer } from "../render/glRenderer"
import { useStore } from "../state/store"
import { effectiveIterations, TIER_DIRECT_MIN_SPAN } from "../util/renderMath"
import { fracBitsFor, FRAC_HP, type Fixed, toDecimalString, toNumber } from "../highprec/fixedpoint"
import type { OrbitRequest, OrbitResult } from "../highprec/referenceOrbit.worker"

// Recompute the reference orbit once the view drifts/zooms past these from the
// anchor it was computed at. Between recomputes, pan/zoom is GPU-only.
const PAN_RECOMPUTE = 0.5 // in screen-half-widths
const ZOOM_RECOMPUTE = 1.5 // span ratio

// Deep-tier adaptive quality. The perturbation loop can take seconds at extreme
// depth, so while interacting we draw a cheap preview, then sharpen once still.
const SETTLE_MS = 150 // idle this long → start sharpening
// The preview keeps FULL iterations — at depth, too few makes everything read as
// interior (black) — and instead scales DOWN resolution to a fixed work budget
// so frames stay responsive. Blurry but structurally correct.
const PREVIEW_STEP_BUDGET = 6e8 // ~fragment·iteration steps per preview frame
const PREVIEW_MIN_W = 120
const SHARP_SCALES = [0.5, 1.0] // progressive resolution once the view settles

/**
 * Full-bleed WebGL2 canvas. Each animation frame it picks a render tier from
 * the current span: the original float32 shader for shallow zoom (unchanged hot
 * path), or the perturbation shader for deep zoom. The deep tier is driven by a
 * Web Worker that computes the reference orbit, and renders adaptively — a fast
 * low-res preview while interacting, progressively sharpened once the view is
 * still — so zoom/pan stay responsive even when a full-quality frame is slow.
 */
export function CanvasLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new GLRenderer(canvas)
    const worker = new Worker(
      new URL("../highprec/referenceOrbit.worker.ts", import.meta.url),
      { type: "module" },
    )

    // Orbit + quality orchestration (mutable, not React state).
    let tier: "direct" | "perturb" = "direct"
    let loadedAnchor: { x: Fixed; y: Fixed } | null = null
    let lastReq: { reqId: number; x: Fixed; y: Fixed; span: number; band: number } | null = null
    let inFlight = false
    let reqCounter = 0

    // Motion / dirty tracking for adaptive quality.
    let lastSpan = -1
    let lastX = 0n
    let lastY = 0n
    let lastCssW = -1
    let lastCssH = -1
    let lastParamsSig = ""
    let lastMoveTime = 0
    let sharpStep = 0
    let sharpDone = false

    const invalidateSharp = () => {
      sharpStep = 0
      sharpDone = false
    }

    worker.onmessage = (e: MessageEvent<OrbitResult>) => {
      inFlight = false
      const res = e.data
      if (!lastReq || res.reqId !== lastReq.reqId) return // superseded
      renderer.setOrbit(res.orbit, res.maxRefIter)
      loadedAnchor = { x: lastReq.x, y: lastReq.y }
      invalidateSharp() // re-sharpen with the fresh orbit
    }

    let raf = 0
    const tick = () => {
      const now = performance.now()
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW > 0 && cssH > 0) {
        const st = useStore.getState()
        const span = st.viewport.span
        const pal = st.palette
        const iters = effectiveIterations(st.iterations, span)
        const dpr = window.devicePixelRatio || 1

        // Tier selection with hysteresis to avoid flicker at the boundary.
        if (span < TIER_DIRECT_MIN_SPAN) tier = "perturb"
        else if (span > TIER_DIRECT_MIN_SPAN * 2) tier = "direct"

        // The view (center/zoom/size) moved → drop to preview + invalidate sharp.
        const viewMoved =
          span !== lastSpan ||
          st.centerHP.x !== lastX ||
          st.centerHP.y !== lastY ||
          cssW !== lastCssW ||
          cssH !== lastCssH
        if (viewMoved) {
          lastMoveTime = now
          lastSpan = span
          lastX = st.centerHP.x
          lastY = st.centerHP.y
          lastCssW = cssW
          lastCssH = cssH
          invalidateSharp()
        }
        // Palette / iteration changes don't move the view but still need a redraw.
        const paramsSig = `${pal.hue},${pal.sat},${pal.val},${pal.scale},${pal.offset},${
          pal.smooth ? 1 : 0
        },${pal.mode},${st.iterations}`
        if (paramsSig !== lastParamsSig) {
          lastParamsSig = paramsSig
          invalidateSharp()
        }
        const moving = now - lastMoveTime < SETTLE_MS

        if (tier === "direct") {
          // Shallow path: full 2× supersampling, every frame (cheap).
          const ratio = Math.min(3, dpr * 2)
          const bw = Math.max(1, Math.floor(cssW * ratio))
          const bh = Math.max(1, Math.floor(cssH * ratio))
          renderer.resize(bw, bh)
          renderer.render({
            tier: "direct",
            cx: st.viewport.cx,
            cy: st.viewport.cy,
            spanX: span,
            width: bw,
            height: bh,
            iterations: iters,
            palette: pal,
          })
          raf = requestAnimationFrame(tick)
          return
        }

        // Deep tier. Settled and already sharp → nothing to redo; keep the frame.
        if (!moving && sharpDone) {
          raf = requestAnimationFrame(tick)
          return
        }

        // Full-resolution backing size (used for orbit precision + sharp passes).
        const sharpRatio = Math.min(3, dpr)
        const sharpW = Math.max(1, Math.floor(cssW * sharpRatio))
        const sharpH = Math.max(1, Math.floor(cssH * sharpRatio))

        // Pan-bias of the live center relative to the loaded orbit's anchor.
        let qx = 0
        let qy = 0
        if (loadedAnchor) {
          qx = toNumber(st.centerHP.x - loadedAnchor.x, FRAC_HP) / span
          qy = toNumber(st.centerHP.y - loadedAnchor.y, FRAC_HP) / span
        }

        // Request a fresh reference orbit if the view drifted/zoomed too far.
        const band = fracBitsFor(span, sharpW)
        const needsOrbit =
          !loadedAnchor ||
          Math.abs(qx) > PAN_RECOMPUTE ||
          Math.abs(qy) > PAN_RECOMPUTE ||
          !lastReq ||
          span < lastReq.span / ZOOM_RECOMPUTE ||
          span > lastReq.span * ZOOM_RECOMPUTE ||
          band !== lastReq.band
        if (needsOrbit && !inFlight) {
          const reqId = ++reqCounter
          const digits = Math.min(340, Math.max(20, Math.ceil(-Math.log10(span)) + 16))
          const req: OrbitRequest = {
            reqId,
            reStr: toDecimalString(st.centerHP.x, FRAC_HP, digits),
            imStr: toDecimalString(st.centerHP.y, FRAC_HP, digits),
            span,
            px: sharpW,
            maxIter: iters,
          }
          lastReq = { reqId, x: st.centerHP.x, y: st.centerHP.y, span, band }
          inFlight = true
          worker.postMessage(req)
        }

        // No orbit yet (first deep frame) — keep the previous frame on screen
        // (don't draw the float32 shader, which is solid black at this depth).
        if (!renderer.hasOrbitData()) {
          raf = requestAnimationFrame(tick)
          return
        }

        // Resolution + iteration budget for this frame.
        let bw: number
        let bh: number
        const aspect = cssW / cssH
        if (moving) {
          // Cheap preview: full iterations, resolution scaled to a work budget.
          const frags = Math.max(
            PREVIEW_MIN_W * PREVIEW_MIN_W,
            PREVIEW_STEP_BUDGET / Math.max(iters, 1),
          )
          let pw = Math.round(Math.sqrt(frags * aspect))
          pw = Math.max(PREVIEW_MIN_W, Math.min(pw, sharpW))
          bw = pw
          bh = Math.max(1, Math.round(pw / aspect))
        } else {
          // Idle: progressively sharpen (half-res → full-res), full iterations.
          const s = SHARP_SCALES[Math.min(sharpStep, SHARP_SCALES.length - 1)]
          bw = Math.max(1, Math.round(sharpW * s))
          bh = Math.max(1, Math.round(sharpH * s))
        }
        renderer.resize(bw, bh)
        renderer.render({
          tier: "perturb",
          cx: 0,
          cy: 0,
          spanX: span,
          width: bw,
          height: bh,
          iterations: iters,
          palette: pal,
          biasX: qx,
          biasY: qy,
        })
        if (!moving) {
          sharpStep++
          if (sharpStep >= SHARP_SCALES.length) sharpDone = true
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      worker.terminate()
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
