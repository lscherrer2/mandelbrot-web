import { COLOR_MODES, MODE_DEFAULTS, type ColorMode } from "../state/hash"
import { useStore } from "../state/store"

/** Display name + an approximate CSS preview of each scheme's gradient. */
const SCHEME_META: Record<ColorMode, { label: string; swatch: string }> = {
  hsv: {
    label: "Rainbow",
    swatch: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
  },
  iq: {
    label: "Cosmic",
    swatch: "linear-gradient(to right, #02020f, #1b6aa8, #8fe3d0, #f7efc3, #e8923c, #02020f)",
  },
  classic: {
    label: "Classic",
    swatch: "linear-gradient(to right, #000764, #206bcb, #edffff, #ffaa00, #000200)",
  },
  ember: {
    label: "Ember",
    swatch: "linear-gradient(to right, #050000, #8c0f00, #ff7300, #ffd940, #ffffeb)",
  },
  ocean: {
    label: "Ocean",
    swatch: "linear-gradient(to right, #030517, #002e73, #0080bf, #40d9d9, #ebffff)",
  },
  pearl: {
    label: "Pearl",
    swatch: "linear-gradient(to right, #121216, #9095bd, #fbfbfd, #b8838a, #121216)",
  },
  zebra: {
    label: "Zebra",
    swatch: "repeating-linear-gradient(to right, #080808 0 7px, #f2f2f7 7px 14px)",
  },
  neon: {
    label: "Neon",
    swatch: "linear-gradient(to right, #000005, #00e8ff, #f4ffff, #00e8ff, #000005)",
  },
  aurora: {
    label: "Aurora",
    swatch: "linear-gradient(to right, #0a1a35, #8a3a8f, #a8c93e, #1ed99b, #0a1a35)",
  },
  clay: {
    label: "Clay",
    swatch: "linear-gradient(to right, #4a332e, #8a6258, #a37f73, #8a6258, #4a332e)",
  },
}

type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt?: (n: number) => string
  onChange: (n: number) => void
}

function Slider({ label, value, min, max, step, fmt, onChange }: SliderProps) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-xs text-zinc-300 mb-1">
        <span>{label}</span>
        <span className="text-zinc-500 tabular-nums">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

type ToggleProps = {
  label: string
  checked: boolean
  onChange: (b: boolean) => void
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={[
          "relative inline-block w-9 h-5 rounded-full border transition-colors shrink-0",
          checked ? "bg-zinc-600 border-zinc-500" : "bg-zinc-800 border-zinc-700",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-zinc-200 transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </span>
      <span>{label}</span>
    </label>
  )
}

type LogSliderProps = {
  label: string
  value: number
  min: number
  max: number
  steps?: number
  fmt?: (n: number) => string
  onChange: (n: number) => void
}

function LogSlider({ label, value, min, max, steps = 1000, fmt, onChange }: LogSliderProps) {
  const logMin = Math.log10(min)
  const logMax = Math.log10(max)
  const sliderVal = ((Math.log10(value) - logMin) / (logMax - logMin)) * steps
  const display = fmt ? fmt(value) : value < 0.01 ? value.toExponential(2) : value.toPrecision(3)
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-xs text-zinc-300 mb-1">
        <span>{label}</span>
        <span className="text-zinc-500 tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={0}
        max={steps}
        step={1}
        value={sliderVal}
        onChange={(e) => {
          const t = Number(e.target.value) / steps
          onChange(Math.pow(10, logMin + t * (logMax - logMin)))
        }}
      />
    </label>
  )
}

export function PalettePanel() {
  const palette = useStore((s) => s.palette)
  const setPalette = useStore((s) => s.setPalette)

  return (
    <section className="px-4 py-3 border-b border-zinc-800/80 space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-zinc-400">Palette</h2>
      <div className="grid grid-cols-3 gap-2">
        {COLOR_MODES.map((m) => {
          const selected = palette.mode === m
          return (
            <button
              key={m}
              type="button"
              title={SCHEME_META[m].label}
              onClick={() => {
                const d = MODE_DEFAULTS[m]
                setPalette({
                  mode: m,
                  hue: d.hue,
                  scale: d.scale,
                  // Schemes built around relief shading switch it on themselves.
                  ...(d.relief !== undefined && { relief: d.relief }),
                })
              }}
              className="group appearance-none flex flex-col items-stretch gap-1"
            >
              <span
                aria-hidden
                className={[
                  "h-5 rounded border transition-colors",
                  selected
                    ? "border-zinc-300 ring-1 ring-zinc-300"
                    : "border-zinc-700 group-hover:border-zinc-500",
                ].join(" ")}
                style={{ background: SCHEME_META[m].swatch }}
              />
              <span
                className={[
                  "text-[10px] leading-none text-center transition-colors",
                  selected ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300",
                ].join(" ")}
              >
                {SCHEME_META[m].label}
              </span>
            </button>
          )
        })}
      </div>
      <Toggle
        label="Smooth coloring"
        checked={palette.smooth}
        onChange={(b) => setPalette({ smooth: b })}
      />
      <Slider
        label="Hue"
        value={palette.hue}
        min={0}
        max={1}
        step={0.01}
        onChange={(n) => setPalette({ hue: n })}
      />
      {/* Slope shading: lights the iteration "heightfield" via dz/dc, faking
          embossed 3D spikes. Composes with every scheme above. */}
      <Slider
        label="Relief (3D)"
        value={palette.relief}
        min={0}
        max={1}
        step={0.01}
        onChange={(n) => setPalette({ relief: n })}
      />
      <LogSlider
        label="Scale"
        value={palette.scale}
        min={0.001}
        max={2}
        onChange={(n) => setPalette({ scale: n })}
      />
    </section>
  )
}
