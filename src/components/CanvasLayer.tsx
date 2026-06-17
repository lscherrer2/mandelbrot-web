import { useEffect, useRef } from "react"

import { GLRenderer } from "../render/glRenderer"
import type { Palette } from "../state/hash"
import { useStore } from "../state/store"
import { effectiveIterations } from "../util/renderMath"
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

// Decoupled pipeline: perturbation passes render into an offscreen texture in
// fence-gated strips (at most ~one strip queued on the GPU at a time), and the
// freshest *finished* texture is blitted to the canvas through the transform
// from its viewport to the live one. Interaction therefore never waits on the
// fractal — zoom/pan/sliders move the cheap blit while renders land async.
// The idle budget also bounds the worst-case hitch when interaction resumes
// mid-sharpen (one already-queued strip must drain before the first blit).
const MOVING_TICK_STEPS = 2e8 // strip budget while interacting (GPU stays preemptible)
const IDLE_TICK_STEPS = 1e9 // strip budget once settled (throughput over latency)

/** An in-flight deep-tier render, pinned to the viewport/params at submit. */
type DeepJob = {
  x: Fixed
  y: Fixed
  span: number
  bw: number
  bh: number
  iters: number
  palette: Palette
  biasX: number
  biasY: number
  nextRow: number
  sharp: boolean // counts toward the sharpStep progression on completion
  scaleStep: number
}

/**
 * Full-bleed WebGL2 canvas. Uses the perturbation renderer at all zoom levels.
 * A Web Worker computes the reference orbit; renders are adaptive — a fast
 * low-res preview while interacting, progressively sharpened once the view is
 * still. Renders run decoupled from the canvas (see DeepJob pipeline above) so
 * zoom/pan stay responsive even when a full-quality frame is slow.
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

    // Deep-tier render pipeline state.
    let job: DeepJob | null = null
    let front: { x: Fixed; y: Fixed; span: number } | null = null
    let frontDirty = false
    let lastStart: { x: Fixed; y: Fixed; span: number; sig: string } | null = null

    const invalidateSharp = () => {
      sharpStep = 0
      sharpDone = false
    }

    worker.onmessage = (e: MessageEvent<OrbitResult>) => {
      inFlight = false
      const res = e.data
      console.log(`[deep] orbit reply req=${res.reqId} maxRefIter=${res.maxRefIter} escaped=${res.refEscaped} frac=${res.fracBits}`)
      if (!lastReq || res.reqId !== lastReq.reqId) return // superseded
      renderer.setOrbit(res.orbit, res.maxRefIter)
      loadedAnchor = { x: lastReq.x, y: lastReq.y }
      // The orbit texture changed under any in-flight job — restart it.
      job = null
      lastStart = null
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
        const palDraw = pal
        const dpr = window.devicePixelRatio || 1

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
          if (job?.sharp) job = null // long render of a stale view — abandon it
        }
        // Palette / iteration changes don't move the view but still need a
        // redraw. Treated as motion so slider drags get cheap preview renders
        // (sharpening only after the slider settles) instead of blocking on
        // full-quality frames.
        const paramsSig = `${pal.hue},${pal.sat},${pal.val},${pal.scale},${pal.offset},${
          pal.relief
        },${pal.stripes},${pal.stripeFreq},${pal.edges},${pal.bands},${
          pal.smooth ? 1 : 0
        },${pal.mode},${st.iterations}`
        if (paramsSig !== lastParamsSig) {
          lastParamsSig = paramsSig
          lastMoveTime = now
          invalidateSharp()
          if (job?.sharp) job = null // its colors are already stale
        }
        const moving = now - lastMoveTime < SETTLE_MS

        // Settled, sharp, nothing in flight → keep the frame as-is.
        if (!moving && sharpDone && job === null && !frontDirty) {
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
          console.log(`[deep] orbit request req=${reqId} span=${span.toExponential(3)} iters=${iters} band=${band}`)
          worker.postMessage(req)
        }

        // No orbit yet — keep the previous frame on screen until the first orbit lands.
        if (!renderer.hasOrbitData()) {
          raf = requestAnimationFrame(tick)
          return
        }

        // Advance the in-flight job: submit the next fence-gated strip, or —
        // once the GPU has drained the last strip — promote it to front.
        if (job && renderer.jobReady()) {
          if (job.nextRow >= job.bh) {
            renderer.finishPerturbJob()
            console.log(`[deep] job done ${job.bw}x${job.bh} sharp=${job.sharp} step=${job.scaleStep}`)
            front = { x: job.x, y: job.y, span: job.span }
            frontDirty = true
            if (job.sharp) {
              sharpStep = job.scaleStep + 1
              if (sharpStep >= SHARP_SCALES.length) sharpDone = true
            }
            job = null
          } else {
            const budget = moving ? MOVING_TICK_STEPS : IDLE_TICK_STEPS
            const rows = Math.min(
              job.bh - job.nextRow,
              Math.max(1, Math.floor(budget / (job.iters * job.bw))),
            )
            renderer.renderPerturbStrip(
              {
                cx: 0,
                cy: 0,
                spanX: job.span,
                width: job.bw,
                height: job.bh,
                iterations: job.iters,
                palette: job.palette,
                biasX: job.biasX,
                biasY: job.biasY,
              },
              job.nextRow,
              rows,
            )
            job.nextRow += rows
          }
        }

        // Start the next job: a preview pinned to the live viewport while
        // moving, or the next sharpening pass once settled.
        if (job === null) {
          const startJob = (bw: number, bh: number, sharp: boolean, scaleStep: number) => {
            renderer.beginPerturbJob(bw, bh)
            job = {
              x: st.centerHP.x,
              y: st.centerHP.y,
              span,
              bw,
              bh,
              iters,
              palette: palDraw,
              biasX: qx,
              biasY: qy,
              nextRow: 0,
              sharp,
              scaleStep,
            }
            lastStart = { x: st.centerHP.x, y: st.centerHP.y, span, sig: paramsSig }
          }
          if (moving) {
            // Only re-preview if the view/params changed since the last start.
            const stale =
              !lastStart ||
              lastStart.x !== st.centerHP.x ||
              lastStart.y !== st.centerHP.y ||
              lastStart.span !== span ||
              lastStart.sig !== paramsSig
            if (stale) {
              // Cheap preview: full iterations, resolution scaled to a work budget.
              const aspect = cssW / cssH
              const frags = Math.max(
                PREVIEW_MIN_W * PREVIEW_MIN_W,
                PREVIEW_STEP_BUDGET / Math.max(iters, 1),
              )
              let pw = Math.round(Math.sqrt(frags * aspect))
              pw = Math.max(PREVIEW_MIN_W, Math.min(pw, sharpW))
              startJob(pw, Math.max(1, Math.round(pw / aspect)), false, 0)
            }
          } else if (!sharpDone) {
            // Idle: progressively sharpen (half-res → full-res), full iterations.
            const step = Math.min(sharpStep, SHARP_SCALES.length - 1)
            const s = SHARP_SCALES[step]
            startJob(
              Math.max(1, Math.round(sharpW * s)),
              Math.max(1, Math.round(sharpH * s)),
              true,
              step,
            )
          }
        }

        // Present: blit the freshest finished frame through the viewport
        // transform. Cheap, so it runs every frame during interaction — this
        // is what keeps zooming fluid while renders are still cooking.
        if (front && (moving || frontDirty)) {
          const offX = toNumber(st.centerHP.x - front.x, FRAC_HP) / front.span
          const offY = toNumber(st.centerHP.y - front.y, FRAC_HP) / front.span
          renderer.resize(sharpW, sharpH)
          renderer.blitFront(sharpW, sharpH, span / front.span, offX, offY)
          frontDirty = false
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
