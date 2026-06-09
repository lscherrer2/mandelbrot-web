import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"

import { clampSpan, type Viewport } from "../util/renderMath"
import {
  type Fixed,
  FRAC_HP,
  fromDecimalString,
  fromNumber,
  toDecimalString,
  toNumber,
} from "../highprec/fixedpoint"
import { DEFAULTS, parseHash, type Palette, writeHash } from "./hash"

/** High-precision view center (fixed-point), the source of truth for cx/cy. */
export type CenterHP = { x: Fixed; y: Fixed }

export type AppState = {
  viewport: Viewport
  /** Full-precision center; pan/zoom mutate this, viewport.cx/cy are derived. */
  centerHP: CenterHP
  setViewport: (v: Viewport) => void
  /** Pan by a screen-pixel delta (drag). vw = surface width in CSS px. */
  panByPixels: (dpx: number, dpy: number, vw: number) => void
  /** Zoom by `factor` (>1 = in) keeping screen point (sx,sy) fixed. */
  zoomAtPixel: (sx: number, sy: number, vw: number, vh: number, factor: number) => void

  iterations: number
  setIterations: (n: number) => void
  palette: Palette
  setPalette: (p: Partial<Palette>) => void

  sidebarOpen: boolean
  setSidebarOpen: (b: boolean) => void

  resetView: () => void
}

function deriveViewport(c: CenterHP, span: number): Viewport {
  return { cx: toNumber(c.x, FRAC_HP), cy: toNumber(c.y, FRAC_HP), span }
}

const initialHash = parseHash()
initialHash.viewport.span = clampSpan(initialHash.viewport.span)
const initialCenter: CenterHP = initialHash.centerStr
  ? {
      x: fromDecimalString(initialHash.centerStr.re, FRAC_HP),
      y: fromDecimalString(initialHash.centerStr.im, FRAC_HP),
    }
  : {
      x: fromNumber(initialHash.viewport.cx, FRAC_HP),
      y: fromNumber(initialHash.viewport.cy, FRAC_HP),
    }
// Keep the double shadow consistent with the (possibly higher-precision) center.
initialHash.viewport.cx = toNumber(initialCenter.x, FRAC_HP)
initialHash.viewport.cy = toNumber(initialCenter.y, FRAC_HP)

const initialSidebar = (() => {
  try {
    const v = localStorage.getItem("mandelbrot.sidebarOpen")
    return v === null ? true : v === "1"
  } catch {
    return true
  }
})()

export const useStore = create<AppState>()(
  subscribeWithSelector((set) => ({
    viewport: initialHash.viewport,
    centerHP: initialCenter,

    setViewport: (v) =>
      set(() => {
        const span = clampSpan(v.span)
        const centerHP = { x: fromNumber(v.cx, FRAC_HP), y: fromNumber(v.cy, FRAC_HP) }
        return { centerHP, viewport: deriveViewport(centerHP, span) }
      }),

    panByPixels: (dpx, dpy, vw) =>
      set((s) => {
        const span = s.viewport.span
        // Drag-down reveals higher complex-y (math convention) → cy increases.
        const ddx = (-dpx * span) / vw
        const ddy = (dpy * span) / vw
        const centerHP = {
          x: s.centerHP.x + fromNumber(ddx, FRAC_HP),
          y: s.centerHP.y + fromNumber(ddy, FRAC_HP),
        }
        return { centerHP, viewport: deriveViewport(centerHP, span) }
      }),

    zoomAtPixel: (sx, sy, vw, vh, factor) =>
      set((s) => {
        const span = s.viewport.span
        const newSpan = clampSpan(span / factor)
        // newCenter − center = (screenOffset)·(span − newSpan)/vw, kept tiny so
        // it accumulates losslessly in fixed-point even at extreme depth.
        const diff = span - newSpan
        const ddx = ((sx - vw / 2) * diff) / vw
        const ddy = (-(sy - vh / 2) * diff) / vw
        const centerHP = {
          x: s.centerHP.x + fromNumber(ddx, FRAC_HP),
          y: s.centerHP.y + fromNumber(ddy, FRAC_HP),
        }
        return { centerHP, viewport: deriveViewport(centerHP, newSpan) }
      }),

    iterations: initialHash.iterations,
    setIterations: (n) => set({ iterations: Math.max(16, Math.min(4096, Math.round(n))) }),

    palette: initialHash.palette,
    setPalette: (p) => set((s) => ({ palette: { ...s.palette, ...p } })),

    sidebarOpen: initialSidebar,
    setSidebarOpen: (b) => {
      try {
        localStorage.setItem("mandelbrot.sidebarOpen", b ? "1" : "0")
      } catch {
        /* ignore */
      }
      set({ sidebarOpen: b })
    },

    resetView: () => {
      const centerHP = {
        x: fromNumber(DEFAULTS.viewport.cx, FRAC_HP),
        y: fromNumber(DEFAULTS.viewport.cy, FRAC_HP),
      }
      set({
        centerHP,
        viewport: deriveViewport(centerHP, DEFAULTS.viewport.span),
        iterations: DEFAULTS.iterations,
        palette: { ...DEFAULTS.palette },
      })
    },
  })),
)

useStore.subscribe(
  (s) => ({
    viewport: s.viewport,
    centerHP: s.centerHP,
    iterations: s.iterations,
    palette: s.palette,
  }),
  ({ viewport, centerHP, iterations, palette }) => {
    // Enough fractional digits to pin the center at the current depth.
    const digits = Math.min(330, Math.max(16, Math.ceil(-Math.log10(viewport.span)) + 12))
    const centerStr = {
      re: toDecimalString(centerHP.x, FRAC_HP, digits),
      im: toDecimalString(centerHP.y, FRAC_HP, digits),
    }
    writeHash({ viewport, iterations, palette, centerStr })
  },
  {
    equalityFn: (a, b) =>
      a.viewport === b.viewport && a.iterations === b.iterations && a.palette === b.palette,
  },
)
