import { Check, Copy, RotateCcw } from "lucide-react"
import { useState } from "react"

import { useStore } from "../state/store"
import { pickZoom } from "../util/renderMath"

function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return "—"
  return Number(n.toPrecision(digits)).toString()
}

export function ViewPanel() {
  const viewport = useStore((s) => s.viewport)
  const resetView = useStore((s) => s.resetView)
  const [copied, setCopied] = useState(false)

  const zoomLevel = pickZoom(viewport.span)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="px-4 py-3 border-b border-zinc-800/80">
      <h2 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">View</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">center</dt>
        <dd className="text-zinc-300 tabular-nums break-all">
          {fmt(viewport.cx, 10)}, {fmt(viewport.cy, 10)}
        </dd>
        <dt className="text-zinc-500">span</dt>
        <dd className="text-zinc-300 tabular-nums">{fmt(viewport.span, 6)}</dd>
        <dt className="text-zinc-500">zoom</dt>
        <dd className="text-zinc-300 tabular-nums">{zoomLevel}</dd>
      </dl>
      <div className="flex gap-2 mt-3">
        <button
          onClick={resetView}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors"
        >
          <RotateCcw size={12} />
          Reset
        </button>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy URL"}
        </button>
      </div>
    </section>
  )
}
