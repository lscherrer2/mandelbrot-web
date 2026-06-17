import type { Palette } from "../state/hash"

export type RenderParams = {
  cx: number
  cy: number
  spanX: number
  width: number
  height: number
  iterations: number
  palette: Palette
  /** (viewCenter − orbitAnchor)/span, in screen-normalized units. */
  biasX?: number
  biasY?: number
}
