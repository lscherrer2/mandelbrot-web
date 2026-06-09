import { Check, Copy, Lock, LockOpen, RotateCcw } from "lucide-react"
import { useState } from "react"

import { useStore } from "../state/store"
import { pickTier, pickZoom } from "../util/renderMath"

function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return "—"
  return Number(n.toPrecision(digits)).toString()
}

function GoToForm() {
  const navigateTo = useStore((s) => s.navigateTo)
  const [re, setRe] = useState("")
  const [im, setIm] = useState("")
  const [open, setOpen] = useState(false)

  const canSubmit = re.trim() !== "" && im.trim() !== ""

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    navigateTo(re.trim(), im.trim())
    setOpen(false)
    setRe("")
    setIm("")
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors"
      >
        Go to…
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2">
      <div>
        <label className="block text-xs text-zinc-500 mb-0.5">Re</label>
        <input
          autoFocus
          type="text"
          value={re}
          onChange={(e) => setRe(e.target.value)}
          placeholder="-0.7269…"
          spellCheck={false}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-0.5">Im</label>
        <input
          type="text"
          value={im}
          onChange={(e) => setIm(e.target.value)}
          placeholder="0.1889…"
          spellCheck={false}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex-1 text-xs px-2.5 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed border border-zinc-600 text-zinc-100 transition-colors"
        >
          Go
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setRe(""); setIm("") }}
          className="text-xs px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export function ViewPanel() {
  const viewport = useStore((s) => s.viewport)
  const resetView = useStore((s) => s.resetView)
  const panLocked = useStore((s) => s.panLocked)
  const setPanLocked = useStore((s) => s.setPanLocked)
  const [copied, setCopied] = useState(false)

  const zoomLevel = pickZoom(viewport.span)
  const fast = pickTier(viewport.span) === "direct"

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
        <dt className="text-zinc-500">algorithm</dt>
        <dd className="text-zinc-300 flex items-center gap-1.5">
          <span>{fast ? "direct" : "perturbation"}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
              fast ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
            }`}
          >
            {fast ? "FAST" : "SLOW"}
          </span>
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2 mt-3">
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
        <button
          onClick={() => setPanLocked(!panLocked)}
          title={panLocked ? "Unlock panning" : "Lock panning"}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors ${
            panLocked
              ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
              : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200"
          }`}
        >
          {panLocked ? <Lock size={12} /> : <LockOpen size={12} />}
          {panLocked ? "Locked" : "Lock"}
        </button>
        <GoToForm />
      </div>
    </section>
  )
}
