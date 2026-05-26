import { useStore } from "../state/store"

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
      <Slider
        label="Hue"
        value={palette.hue}
        min={0}
        max={1}
        step={0.01}
        onChange={(n) => setPalette({ hue: n })}
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
