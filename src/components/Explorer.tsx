import { CanvasLayer } from "./CanvasLayer"
import { GestureSurface } from "./GestureSurface"

export function Explorer() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <CanvasLayer />
      <GestureSurface />
    </div>
  )
}
