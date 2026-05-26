import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"

import type { PrecisionTier, Viewport } from "../util/renderMath"
import { DEFAULTS, parseHash, type Palette, writeHash } from "./hash"

export type AppState = {
  viewport: Viewport
  setViewport: (v: Viewport) => void

  iterations: number
  setIterations: (n: number) => void
  palette: Palette
  setPalette: (p: Partial<Palette>) => void

  sidebarOpen: boolean
  setSidebarOpen: (b: boolean) => void

  precisionTier: PrecisionTier
  setPrecisionTier: (t: PrecisionTier) => void

  resetView: () => void
}

const initialHash = parseHash()
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
    setViewport: (v) => set({ viewport: v }),

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

    precisionTier: "f32",
    setPrecisionTier: (t) => set({ precisionTier: t }),

    resetView: () => {
      set({
        viewport: { ...DEFAULTS.viewport },
        iterations: DEFAULTS.iterations,
        palette: { ...DEFAULTS.palette },
      })
    },
  })),
)

useStore.subscribe(
  (s) => ({ viewport: s.viewport, iterations: s.iterations, palette: s.palette }),
  ({ viewport, iterations, palette }) => writeHash({ viewport, iterations, palette }),
  {
    equalityFn: (a, b) =>
      a.viewport === b.viewport && a.iterations === b.iterations && a.palette === b.palette,
  },
)
