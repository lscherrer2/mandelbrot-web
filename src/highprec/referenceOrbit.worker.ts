/**
 * Web Worker that computes the high-precision Mandelbrot *reference orbit* for a
 * deep-zoom anchor `C`, off the main thread.
 *
 * It iterates `Z_{n+1} = Z_n² + C` in BigInt fixed-point (precision scaled to
 * the requested span), stops at bailout (|Z|>2) or the iteration cap, and posts
 * back the orbit as a Transferable `Float32Array` of interleaved (Re, Im) — the
 * exact layout the GPU reference-orbit texture consumes.
 *
 * Only `Z_n` ever needs high precision; the per-pixel deltas run on the GPU.
 */

import { fracBitsFor, fromDecimalString, fromNumber, mul, toFloat32 } from "./fixedpoint"

export type OrbitRequest = {
  reqId: number
  /** Anchor coordinate as full-precision decimal strings (URL-hash safe). */
  reStr: string
  imStr: string
  span: number
  px: number
  maxIter: number
}

export type OrbitResult = {
  reqId: number
  /** Interleaved (Re, Im) float32 pairs, index n = Z_n. Transferred, not copied. */
  orbit: Float32Array
  /** Last valid orbit index (the reference "length" used by rebasing). */
  maxRefIter: number
  /** Whether the reference itself escaped (vs. hit the iteration cap). */
  refEscaped: boolean
  fracBits: number
}

// Typed view of the worker global, avoiding DOM/WebWorker lib conflicts.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<OrbitRequest>) => void) | null
  postMessage(message: OrbitResult, transfer: Transferable[]): void
}

ctx.onmessage = (e: MessageEvent<OrbitRequest>) => {
  const req = e.data
  const frac = fracBitsFor(req.span, req.px)
  const Cx = fromDecimalString(req.reStr, frac)
  const Cy = fromDecimalString(req.imStr, frac)
  const four = fromNumber(4, frac)
  const N = Math.max(1, req.maxIter)

  const orbit = new Float32Array((N + 1) * 2)
  let X = 0n
  let Y = 0n
  let maxRefIter = N
  let refEscaped = false

  for (let n = 0; n <= N; n++) {
    orbit[2 * n] = toFloat32(X, frac)
    orbit[2 * n + 1] = toFloat32(Y, frac)

    const xx = mul(X, X, frac)
    const yy = mul(Y, Y, frac)
    if (xx + yy > four) {
      maxRefIter = n
      refEscaped = true
      break
    }
    // Z' = Z² + C
    const nx = xx - yy + Cx
    const ny = (mul(X, Y, frac) << 1n) + Cy // 2·X·Y + C_i
    X = nx
    Y = ny
  }

  const result: OrbitResult = { reqId: req.reqId, orbit, maxRefIter, refEscaped, fracBits: frac }
  ctx.postMessage(result, [orbit.buffer])
}
