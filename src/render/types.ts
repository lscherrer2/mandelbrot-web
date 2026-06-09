import type { Palette } from "../state/hash"
import type { Tier } from "../util/renderMath"

export type RenderParams = {
  /** Which renderer to dispatch. "direct" = float32 (shallow), "perturb" = deep. */
  tier: Tier
  cx: number
  cy: number
  spanX: number
  width: number
  height: number
  iterations: number
  palette: Palette
  /** Perturb-only: (viewCenter − orbitAnchor)/span, in screen-normalized units. */
  biasX?: number
  biasY?: number
}
