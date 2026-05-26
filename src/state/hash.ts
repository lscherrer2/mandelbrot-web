/**
 * URL-hash persistence for viewport + palette + iterations.
 *
 * Schema:  #c=<cx>,<cy>&s=<span>&it=<iter>&p=<hue>,<sat>,<val>,<scale>,<offset>
 *
 * Defaults if absent: cx=-0.5, cy=0, span=3.5, it=512, p=0.6,0.8,1,1,0
 */

import type { Viewport } from "../util/renderMath"

export type Palette = {
  hue: number
  sat: number
  val: number
  scale: number
  offset: number
}

export type PersistedState = {
  viewport: Viewport
  iterations: number
  palette: Palette
}

export const DEFAULTS: PersistedState = {
  viewport: { cx: -0.5, cy: 0, span: 3.5 },
  iterations: 512,
  palette: { hue: 0.6, sat: 0.8, val: 1.0, scale: 1.0, offset: 0.0 },
}

function num(s: string | undefined, fallback: number): number {
  if (s === undefined) return fallback
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : fallback
}

export function parseHash(hash: string = window.location.hash): PersistedState {
  const out: PersistedState = {
    viewport: { ...DEFAULTS.viewport },
    iterations: DEFAULTS.iterations,
    palette: { ...DEFAULTS.palette },
  }
  if (!hash || hash.length < 2) return out
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash)
  const c = params.get("c")?.split(",")
  if (c && c.length === 2) {
    out.viewport.cx = num(c[0], out.viewport.cx)
    out.viewport.cy = num(c[1], out.viewport.cy)
  }
  out.viewport.span = num(params.get("s") ?? undefined, out.viewport.span)
  out.iterations = Math.round(num(params.get("it") ?? undefined, out.iterations))
  const p = params.get("p")?.split(",")
  if (p && p.length === 5) {
    out.palette.hue = num(p[0], out.palette.hue)
    out.palette.sat = num(p[1], out.palette.sat)
    out.palette.val = num(p[2], out.palette.val)
    out.palette.scale = num(p[3], out.palette.scale)
    out.palette.offset = num(p[4], out.palette.offset)
  }
  return out
}

function fmt(n: number, digits = 6): string {
  // Compact representation: drop trailing zeros, keep enough precision for
  // deep zooms (~1e-12 of complex plane).
  return Number(n.toPrecision(digits)).toString()
}

export function encodeHash(s: PersistedState): string {
  const parts = [
    `c=${fmt(s.viewport.cx, 12)},${fmt(s.viewport.cy, 12)}`,
    `s=${fmt(s.viewport.span, 6)}`,
    `it=${s.iterations}`,
    `p=${fmt(s.palette.hue)},${fmt(s.palette.sat)},${fmt(s.palette.val)},${fmt(s.palette.scale)},${fmt(s.palette.offset)}`,
  ]
  return "#" + parts.join("&")
}

let throttleHandle: number | null = null
let pendingState: PersistedState | null = null
const THROTTLE_MS = 100

/** Write to URL hash. Throttled to ~10Hz via replaceState. */
export function writeHash(s: PersistedState): void {
  pendingState = s
  if (throttleHandle !== null) return
  throttleHandle = window.setTimeout(() => {
    throttleHandle = null
    if (pendingState) {
      history.replaceState(null, "", encodeHash(pendingState))
      pendingState = null
    }
  }, THROTTLE_MS)
}
