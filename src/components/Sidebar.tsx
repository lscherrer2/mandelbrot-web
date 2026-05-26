import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { useStore } from "../state/store"

import { PalettePanel } from "./PalettePanel"
import { ViewPanel } from "./ViewPanel"

const SIDEBAR_WIDTH = 280

export function Sidebar() {
  const open = useStore((s) => s.sidebarOpen)
  const setOpen = useStore((s) => s.setSidebarOpen)

  return (
    <>
      {/* Collapsed-state trigger sits on the very left edge. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute top-3 left-3 z-30 inline-flex items-center justify-center w-8 h-8 rounded-md bg-zinc-900/80 backdrop-blur border border-zinc-800/80 hover:bg-zinc-800 text-zinc-300 transition-colors"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          transform: open ? "translateX(0)" : `translateX(-${SIDEBAR_WIDTH}px)`,
        }}
        className="absolute top-0 left-0 z-20 h-full bg-zinc-900/80 backdrop-blur-md border-r border-zinc-800/80 text-zinc-100 transition-transform duration-200 ease-out overflow-y-auto"
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
            <PanelLeftClose size={16} />
          </button>
        </header>
        <PalettePanel />
        <ViewPanel />
        <footer className="px-4 py-3 text-[10px] text-zinc-600">
          drag to pan · pinch / scroll to zoom
        </footer>
      </aside>
    </>
  )
}
