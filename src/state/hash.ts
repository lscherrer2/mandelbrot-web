/**
 * URL-hash persistence for viewport + palette + iterations.
 *
 * Schema:  #c=<cx>,<cy>&s=<span>&it=<iter>&p=<hue>,<sat>,<val>,<scale>,<offset>&rl=<relief>&sm=<0|1>&as=<0|1>&m=<mode>&lk=<0|1>&ch=<reStr>,<imStr>
 *          (mode ∈ COLOR_MODES, e.g. hsv, iq, classic, …)
 *
 * `c` is the double-precision center (good to ~1e-15). `ch` carries the center
 * as full-precision decimal strings, added only for deep views — doubles cannot
 * hold the ~300 digits a 1e-300 coordinate needs. When present, `ch` wins.
 *
 * Defaults if absent: cx=-0.5, cy=0, span=3.5, it=512, p=0.6,0.8,1,0.3,0, sm=1, m=hsv
 */

import type { Viewport } from "../util/renderMath"

/**
 * Color schemes, in shader-index order — position here IS the uMode int the
 * fragment shaders switch on (see src/render/palette.glsl). Append only.
 */
export const COLOR_MODES = [
  "hsv",
  "iq",
  "classic",
  "ember",
  "ocean",
  "pearl",
  "zebra",
  "neon",
  "aurora",
  "clay",
] as const

export type ColorMode = (typeof COLOR_MODES)[number]

export const MODE_INDEX = Object.fromEntries(COLOR_MODES.map((m, i) => [m, i])) as Record<
  ColorMode,
  number
>

export type Palette = {
  hue: number
  sat: number
  val: number
  scale: number
  offset: number
  /** Slope-shading ("3D relief") strength, 0 = off … 1 = full. */
  relief: number
  smooth: boolean
  mode: ColorMode
}

export type PersistedState = {
  viewport: Viewport
  iterations: number
  palette: Palette
  panLocked: boolean
  /** Full-precision center (decimal strings). Present only for deep views. */
  centerStr?: { re: string; im: string }
}

export const MODE_DEFAULTS: Record<
  ColorMode,
  { hue: number; scale: number; relief?: number }
> = {
  hsv: { hue: 0.0, scale: 0.25 },
  iq: { hue: 1.0, scale: 0.3 },
  classic: { hue: 0.0, scale: 0.5 },
  ember: { hue: 0.0, scale: 0.5 },
  ocean: { hue: 0.0, scale: 0.5 },
  pearl: { hue: 0.0, scale: 0.4 },
  zebra: { hue: 0.6, scale: 0.4 },
  neon: { hue: 0.5, scale: 0.5 },
  aurora: { hue: 0.0, scale: 0.5 },
  // Near-flat tint: the look comes entirely from relief shading, so turn it on.
  clay: { hue: 0.04, scale: 0.05, relief: 1.0 },
}

export const DEFAULTS: PersistedState = {
  viewport: { cx: -1.083917515, cy: 0.04043246738, span: 4.59824 },
  iterations: 512,
  panLocked: false,
  palette: {
    hue: MODE_DEFAULTS.iq.hue,
    sat: 0.8,
    val: 1.0,
    scale: MODE_DEFAULTS.iq.scale,
    offset: 0.0,
    relief: 0.0,
    smooth: true,
    mode: "iq",
  },
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
    panLocked: DEFAULTS.panLocked,
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
  out.palette.relief = num(params.get("rl") ?? undefined, out.palette.relief)
  const sm = params.get("sm")
  if (sm !== null) out.palette.smooth = sm !== "0"
  const lk = params.get("lk")
  if (lk !== null) out.panLocked = lk !== "0"
  const m = params.get("m")
  if (m && (COLOR_MODES as readonly string[]).includes(m)) out.palette.mode = m as ColorMode
  const ch = params.get("ch")?.split(",")
  if (ch && ch.length === 2 && ch[0] && ch[1]) {
    out.centerStr = { re: ch[0], im: ch[1] }
  }
  return out
}

function fmt(n: number, digits = 6): string {
  // Compact representation: drop trailing zeros, keep enough precision for
  // deep zooms (~1e-12 of complex plane).
  return Number(n.toPrecision(digits)).toString()
}

// Below this span, doubles can't pin the center — emit the full-precision `ch`.
const DEEP_SPAN = 1e-10

export function encodeHash(s: PersistedState): string {
  const parts = [
    `c=${fmt(s.viewport.cx, 12)},${fmt(s.viewport.cy, 12)}`,
    `s=${fmt(s.viewport.span, 6)}`,
    `it=${s.iterations}`,
    `p=${fmt(s.palette.hue)},${fmt(s.palette.sat)},${fmt(s.palette.val)},${fmt(s.palette.scale)},${fmt(s.palette.offset)}`,
    `rl=${fmt(s.palette.relief, 3)}`,
    `sm=${s.palette.smooth ? 1 : 0}`,
    `m=${s.palette.mode}`,
    `lk=${s.panLocked ? 1 : 0}`,
  ]
  if (s.centerStr && s.viewport.span < DEEP_SPAN) {
    parts.push(`ch=${s.centerStr.re},${s.centerStr.im}`)
  }
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
