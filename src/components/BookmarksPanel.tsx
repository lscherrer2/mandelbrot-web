import { Check, Copy, MapPin, Trash2 } from "lucide-react"
import { useState } from "react"

import { type Bookmark, useStore } from "../state/store"

function BookmarkRow({ b }: { b: Bookmark }) {
  const loadBookmark = useStore((s) => s.loadBookmark)
  const deleteBookmark = useStore((s) => s.deleteBookmark)
  const [copied, setCopied] = useState(false)

  const shareUrl =
    window.location.origin + window.location.pathname.replace(/\/$/, "") + b.hash

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteBookmark(b.id)
  }

  return (
    <div className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-zinc-800/60 transition-colors">
      <button
        onClick={() => loadBookmark(b)}
        className="flex-1 text-left text-xs text-zinc-200 truncate"
        title={b.name}
      >
        {b.name}
      </button>
      <button
        onClick={onCopy}
        title="Copy share link"
        className="shrink-0 p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      <button
        onClick={onDelete}
        title="Delete bookmark"
        className="shrink-0 p-1 text-zinc-600 hover:text-red-400 transition-colors"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

export function BookmarksPanel() {
  const bookmarks = useStore((s) => s.bookmarks)
  const saveBookmark = useStore((s) => s.saveBookmark)
  const [name, setName] = useState("")
  const [adding, setAdding] = useState(false)

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    saveBookmark(trimmed)
    setName("")
    setAdding(false)
  }

  return (
    <section className="px-4 py-3 border-b border-zinc-800/80">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wider text-zinc-400">Bookmarks</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition-colors"
          >
            <MapPin size={10} />
            Save view
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleSave} className="flex gap-1.5 mb-2">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this view…"
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="shrink-0 text-xs px-2.5 py-1 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed border border-zinc-600 text-zinc-100 transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setName("") }}
            className="shrink-0 text-xs px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 transition-colors"
          >
            ✕
          </button>
        </form>
      )}

      {bookmarks.length === 0 ? (
        <p className="text-[11px] text-zinc-600 italic">No bookmarks yet</p>
      ) : (
        <div className="-mx-2 space-y-0.5">
          {bookmarks.map((b) => (
            <BookmarkRow key={b.id} b={b} />
          ))}
        </div>
      )}
    </section>
  )
}
