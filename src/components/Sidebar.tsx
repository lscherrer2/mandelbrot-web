import { useDrag } from "@use-gesture/react"
import {
  Home,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { useRef } from "react"

import { useStore } from "../state/store"

import { BookmarksPanel } from "./BookmarksPanel"
import { PalettePanel } from "./PalettePanel"
import { ViewPanel } from "./ViewPanel"

export function Sidebar() {
  const open = useStore((s) => s.sidebarOpen)
  const setOpen = useStore((s) => s.setSidebarOpen)
  const resetView = useStore((s) => s.resetView)
  const asideRef = useRef<HTMLElement>(null)

  // Swipe to dismiss: down in portrait, left in landscape. Only engage when
  // the drag starts at the top of the scroll area in portrait — landscape
  // doesn't need that guard since horizontal drags don't fight scrolling.
  useDrag(
    ({ first, last, movement: [mx, my], velocity: [vx, vy], memo }) => {
      if (first) {
        const landscape = window.matchMedia("(orientation: landscape)").matches
        return {
          landscape,
          startedAtTop: (asideRef.current?.scrollTop ?? 0) <= 0,
        }
      }
      const m = memo as { landscape: boolean; startedAtTop: boolean } | undefined
      if (!m) return m
      if (!last) return m
      if (m.landscape) {
        if (mx < 0 && (-mx > 80 || vx > 0.4)) setOpen(false)
      } else {
        if (m.startedAtTop && my > 0 && (my > 80 || vy > 0.4)) setOpen(false)
      }
      return m
    },
    { target: asideRef, pointer: { touch: true } },
  )

  return (
    <>
      <button
        onClick={resetView}
        className="fixed z-40 inline-flex items-center justify-center w-9 h-9 rounded-md bg-zinc-900/80 backdrop-blur border border-zinc-800/80 hover:bg-zinc-800 text-zinc-300 transition-colors right-3"
        style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
        aria-label="Reset to defaults"
        title="Reset to defaults"
      >
        <Home size={16} />
      </button>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute z-30 inline-flex items-center justify-center w-8 h-8 rounded-md bg-zinc-900/80 backdrop-blur border border-zinc-800/80 hover:bg-zinc-800 text-zinc-300 transition-colors bottom-3 right-3 landscape:top-3 landscape:left-3 landscape:right-auto landscape:bottom-auto"
          aria-label="Open sidebar"
        >
          <PanelBottomOpen size={16} className="landscape:hidden" />
          <PanelLeftOpen size={16} className="hidden landscape:block" />
        </button>
      )}
      <aside
        ref={asideRef}
        className={[
          "absolute z-20 bg-zinc-900/80 backdrop-blur-md text-zinc-100 transition-transform duration-200 ease-out overflow-y-auto",
          // Mobile: full width, anchored to bottom, capped height, slide up.
          "left-0 right-0 bottom-0 w-full max-h-[75vh] border-t border-zinc-800/80 rounded-t-xl",
          // Desktop (md+): fixed-width left panel, full height, slide in from left.
          "landscape:top-0 landscape:right-auto landscape:bottom-0 landscape:h-full landscape:w-[280px] landscape:max-h-none landscape:rounded-none landscape:border-t-0 landscape:border-r",
          open
            ? "translate-y-0 landscape:translate-x-0"
            : "translate-y-full landscape:translate-y-0 landscape:-translate-x-full",
        ].join(" ")}
      >
        <header className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/80">
          <h1 className="text-sm font-medium tracking-tight text-zinc-100">
            Mandelbrot Explorer
          </h1>
          <button
            onClick={() => setOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Close sidebar"
          >
            <PanelBottomClose size={16} className="landscape:hidden" />
            <PanelLeftClose size={16} className="hidden landscape:block" />
          </button>
        </header>
        <PalettePanel />
        <ViewPanel />
        <BookmarksPanel />
        <footer className="px-4 py-3 text-[10px] text-zinc-600">
          drag to pan · pinch / scroll to zoom
        </footer>
      </aside>
    </>
  )
}
