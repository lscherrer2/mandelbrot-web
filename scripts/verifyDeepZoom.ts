/**
 * Deep-zoom correctness harness (run: `node scripts/verifyDeepZoom.ts`).
 *
 * Validates the Tier C perturbation algorithm end to end, off-GPU:
 *
 *  1. Finds real "spike" minibrot nuclei near c = −2 by Newton's method on
 *     Z_p(c) = 0 in BigInt fixed-point. Period p gives a minibrot of scale
 *     ~16^−p, so p = 12 / 82 / 166 / 250 pin views at ~1e-14 / 1e-98 / 1e-200
 *     / 1e-300 — the reported breakdown depth and the target depth.
 *  2. Renders a 7×7 pixel grid two ways:
 *       — ground truth: direct BigInt fixed-point iteration per pixel;
 *       — bit-faithful JS emulations of the GPU shader (float32 via
 *         Math.fround + flush-to-zero), for BOTH the legacy plain-float32
 *         algorithm and the new floatexp algorithm, with the reference orbit
 *         produced by the real writeMantExp() from src/highprec/fixedpoint.ts.
 *  3. Compares smooth iteration values. Expectation: the legacy emulation
 *     reproduces the ~1e-98 fragmenting (mismatch vs truth), the floatexp
 *     emulation matches truth at every depth.
 *
 * Also prints ready-to-paste URL hashes for in-browser visual verification.
 */

import {
  type Fixed,
  E_ZERO,
  fromNumber,
  mul,
  toDecimalString,
  toNumber,
  writeMantExp,
} from "../src/highprec/fixedpoint.ts"

// ---------------------------------------------------------------------------
// float32 emulation (conservative GPU semantics: flush-to-zero on subnormals)

const MIN_NORMAL = Math.pow(2, -126)

function f32(x: number): number {
  const f = Math.fround(x)
  return f !== 0 && Math.abs(f) < MIN_NORMAL ? 0 : f
}

function exp2f(e: number): number {
  return f32(Math.pow(2, f32(e)))
}

type V2 = { x: number; y: number }

function cmulf(a: V2, b: V2): V2 {
  return {
    x: f32(f32(a.x * b.x) - f32(a.y * b.y)),
    y: f32(f32(a.x * b.y) + f32(a.y * b.x)),
  }
}

function renorm(d: V2, e: number): number {
  const mag = Math.max(Math.abs(d.x), Math.abs(d.y))
  if (mag > 0) {
    const k = Math.min(126, Math.max(-126, Math.floor(f32(Math.log2(mag)))))
    const s = exp2f(-k)
    d.x = f32(d.x * s)
    d.y = f32(d.y * s)
    e = f32(e + k)
  }
  return e
}

// ---------------------------------------------------------------------------
// Newton's method for spike nuclei: solve Z_p(c) = 0 on the real axis

function divFixed(a: Fixed, b: Fixed, frac: number): Fixed {
  return (a << BigInt(frac)) / b
}

/** Real-axis Newton for the period-p nucleus, from seed c0 (fixed-point). */
function newtonNucleus(p: number, c0: Fixed, frac: number): Fixed {
  let c = c0
  for (let step = 0; step < 40; step++) {
    let z = 0n
    let dc = 0n
    const one = 1n << BigInt(frac)
    for (let k = 0; k < p; k++) {
      dc = (mul(z, dc, frac) << 1n) + one // dz/dc' = 2·z·dc + 1
      z = mul(z, z, frac) + c
    }
    if (dc === 0n) throw new Error("Newton: zero derivative")
    const delta = divFixed(z, dc, frac)
    c -= delta
    const ad = delta < 0n ? -delta : delta
    if (ad >> BigInt(Math.max(0, frac - 64)) === 0n && step > 4) break
  }
  return c
}

/** Bootstrap the spike seed constant K (ε_p ≈ K·4^−p) from double-precision. */
function spikeSeedConstant(): number {
  const p = 10
  let c = -2 + 14 * Math.pow(4, -p)
  for (let step = 0; step < 60; step++) {
    let z = 0
    let dc = 0
    for (let k = 0; k < p; k++) {
      dc = 2 * z * dc + 1
      z = z * z + c
    }
    c -= z / dc
  }
  return (c + 2) * Math.pow(4, p)
}

/** log2 |v/2^frac| (v ≠ 0), via bit length — immune to double over/underflow. */
function log2Fixed(v: Fixed, frac: number): number {
  let a = v < 0n ? -v : v
  let bits = 0
  for (let c = 512; c >= 1; c >>= 1) {
    const s = BigInt(c)
    while (a >> s) {
      a >>= s
      bits += c
    }
  }
  return bits + 1 - frac
}

// ---------------------------------------------------------------------------
// Ground truth: direct fixed-point iteration of one pixel

const R2 = 65536 // matches the shader bailout²

type PixelResult = { esc: number; l: number } // esc = -1 → interior

function truthPixel(cx: Fixed, cy: Fixed, frac: number, maxIter: number): PixelResult {
  const bail = BigInt(R2) << BigInt(frac)
  let x = 0n
  let y = 0n
  for (let n = 0; n <= maxIter; n++) {
    const xx = mul(x, x, frac)
    const yy = mul(y, y, frac)
    const zz2 = xx + yy
    if (zz2 > bail) {
      const zz = toNumber(zz2, frac)
      return { esc: n, l: n - Math.log2(Math.log2(zz)) + 4 }
    }
    const nx = xx - yy + cx
    y = (mul(x, y, frac) << 1n) + cy
    x = nx
  }
  return { esc: -1, l: -1 }
}

// ---------------------------------------------------------------------------
// Reference orbit (mirrors the worker, both output layouts)

function computeOrbits(cRe: Fixed, cIm: Fixed, frac: number, N: number) {
  const quad = new Float32Array((N + 1) * 4) // new layout: mant/exp
  const pair = new Float32Array((N + 1) * 2) // legacy layout: plain float32
  const four = fromNumber(4, frac)
  let X = 0n
  let Y = 0n
  let maxRefIter = N
  for (let n = 0; n <= N; n++) {
    writeMantExp(quad, 4 * n, X, Y, frac)
    pair[2 * n] = toNumber(X, frac)
    pair[2 * n + 1] = toNumber(Y, frac)
    const xx = mul(X, X, frac)
    const yy = mul(Y, Y, frac)
    if (xx + yy > four) {
      maxRefIter = n
      break
    }
    const nx = xx - yy + cRe
    Y = (mul(X, Y, frac) << 1n) + cIm
    X = nx
  }
  return { quad, pair, maxRefIter }
}

// ---------------------------------------------------------------------------
// Legacy shader emulation (the pre-fix algorithm, for reproducing the bug)

function legacyPixel(
  orbit: Float32Array,
  maxRefIter: number,
  dcMant: V2,
  se: number,
  maxIter: number,
): PixelResult {
  const d: V2 = { x: 0, y: 0 }
  let ex = se
  let m = 0
  for (let iter = 0; iter < maxIter; iter++) {
    let Zx = orbit[2 * m]
    let Zy = orbit[2 * m + 1]
    const s = exp2f(ex)
    const scaled: V2 = { x: f32(d.x * s), y: f32(d.y * s) }
    const z: V2 = { x: f32(Zx + scaled.x), y: f32(Zy + scaled.y) }
    const zz = f32(f32(z.x * z.x) + f32(z.y * z.y))
    if (zz > R2) return { esc: iter, l: iter - Math.log2(Math.log2(zz)) + 4 }
    const zmag = Math.max(Math.abs(z.x), Math.abs(z.y))
    const dmag = Math.max(Math.abs(scaled.x), Math.abs(scaled.y))
    if (zmag < dmag || m >= maxRefIter) {
      d.x = z.x
      d.y = z.y
      ex = renorm(d, 0)
      m = 0
      Zx = 0
      Zy = 0
    }
    const a = cmulf({ x: f32(2 * Zx), y: f32(2 * Zy) }, d)
    const b = cmulf(d, d)
    const Ep = Math.max(ex, se)
    const sa = exp2f(ex - Ep)
    const sb = exp2f(2 * ex - Ep)
    const sc = exp2f(se - Ep)
    d.x = f32(f32(f32(a.x * sa) + f32(b.x * sb)) + f32(dcMant.x * sc))
    d.y = f32(f32(f32(a.y * sa) + f32(b.y * sb)) + f32(dcMant.y * sc))
    ex = renorm(d, Ep)
    m++
  }
  return { esc: -1, l: -1 }
}

// ---------------------------------------------------------------------------
// Floatexp shader emulation (mirrors src/render/mandelbrot.perturb.frag)

function pexp2(e: number): number {
  return exp2f(Math.max(e, -200))
}

function floatexpPixel(
  orbit: Float32Array,
  maxRefIter: number,
  dcMant: V2,
  se: number,
  maxIter: number,
): PixelResult {
  const d: V2 = { x: 0, y: 0 }
  let ex = se
  let m = 0
  for (let iter = 0; iter < maxIter; iter++) {
    let Zmx = orbit[4 * m]
    let Zmy = orbit[4 * m + 1]
    let Ze = orbit[4 * m + 2]

    let zE = Math.max(Ze, ex)
    const sZ = pexp2(Ze - zE)
    const sd = pexp2(ex - zE)
    const zm: V2 = {
      x: f32(f32(Zmx * sZ) + f32(d.x * sd)),
      y: f32(f32(Zmy * sZ) + f32(d.y * sd)),
    }
    zE = renorm(zm, zE)

    const zfs = zE > -120 ? exp2f(zE) : 0
    const zf: V2 = { x: f32(zm.x * zfs), y: f32(zm.y * zfs) }
    const zz = f32(f32(zf.x * zf.x) + f32(zf.y * zf.y))
    if (zz > R2) return { esc: iter, l: iter - Math.log2(Math.log2(zz)) + 4 }

    const zMagM = Math.max(Math.abs(zm.x), Math.abs(zm.y))
    const dMagM = Math.max(Math.abs(d.x), Math.abs(d.y))
    const zSmaller = zMagM === 0 ? dMagM > 0 : zE < ex || (zE === ex && zMagM < dMagM)
    if (zSmaller || m >= maxRefIter) {
      d.x = zm.x
      d.y = zm.y
      ex = zE
      m = 0
      Zmx = 0
      Zmy = 0
      Ze = E_ZERO
    }

    const a = cmulf({ x: Zmx, y: Zmy }, d)
    const eA = f32(Ze + ex + 1)
    const b = cmulf(d, d)
    const eB = f32(ex + ex)
    const Ep = Math.max(Math.max(eA, eB), se)
    const sa = pexp2(eA - Ep)
    const sb = pexp2(eB - Ep)
    const sc = pexp2(se - Ep)
    d.x = f32(f32(f32(a.x * sa) + f32(b.x * sb)) + f32(dcMant.x * sc))
    d.y = f32(f32(f32(a.y * sa) + f32(b.y * sb)) + f32(dcMant.y * sc))
    ex = renorm(d, Ep)
    m++
  }
  return { esc: -1, l: -1 }
}

// ---------------------------------------------------------------------------
// Harness

const GRID = 7
const MAX_ITER = 40000

type Summary = {
  classMismatch: number
  maxDl: number
  escapedTruth: number
  interiorTruth: number
  distinctEsc: number
}

function compare(truth: PixelResult[], emu: PixelResult[]): Summary {
  let classMismatch = 0
  let maxDl = 0
  let escapedTruth = 0
  let interiorTruth = 0
  const escs = new Set<number>()
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i]
    const e = emu[i]
    if (t.esc < 0) interiorTruth++
    else {
      escapedTruth++
      escs.add(t.esc)
    }
    if (t.esc < 0 !== e.esc < 0) classMismatch++
    else if (t.esc >= 0) maxDl = Math.max(maxDl, Math.abs(t.l - e.l))
  }
  return { classMismatch, maxDl, escapedTruth, interiorTruth, distinctEsc: escs.size }
}

function runDepth(period: number, K: number) {
  // Working precision: enough for the expected ~16^-p scale plus margin.
  const frac = Math.ceil((4 * period + 256) / 32) * 32

  // Newton from the asymptotic spike seed c ≈ −2 + K·4^−p.
  const c = newtonNucleus(period, fromNumber(-2, frac) + (fromNumber(K, frac) >> BigInt(2 * period)), frac)

  // Residual check: |Z_p(c)| must be ~0 at working precision.
  let z = 0n
  for (let k = 0; k < period; k++) {
    z = mul(z, z, frac) + c
  }
  const residLog2 = z === 0n ? -Infinity : log2Fixed(z, frac)
  if (!(residLog2 < -frac / 2)) {
    throw new Error(`period ${period}: Newton residual too large (2^${residLog2})`)
  }

  // Λ = dZ_p/dc at the nucleus → minibrot scale ~ 1/Λ².
  let zd = 0n
  let dc = 0n
  const one = 1n << BigInt(frac)
  for (let k = 0; k < period; k++) {
    dc = (mul(zd, dc, frac) << 1n) + one
    zd = mul(zd, zd, frac) + c
  }
  const log2Lambda = log2Fixed(dc, frac)
  const log2Size = -2 * log2Lambda

  // Pick a span (powers of two around the size estimate) whose ground-truth
  // grid shows real structure: several distinct escape counts.
  let chosen: { span: number; truth: PixelResult[] } | null = null
  for (const j of [4, 2, 6, 0, 8]) {
    const span = Math.pow(2, log2Size + j)
    const truth = renderTruth(c, span, frac)
    const s = compare(truth, truth)
    if (s.distinctEsc >= 3 && s.escapedTruth >= GRID) {
      chosen = { span, truth }
      break
    }
  }
  if (!chosen) throw new Error(`period ${period}: no span with structure found`)
  const { span, truth } = chosen

  // Reference orbit at the nucleus anchor, both texture layouts.
  const { quad, pair, maxRefIter } = computeOrbits(c, 0n, frac, MAX_ITER)

  // Emulated GPU renders.
  const se = Math.floor(Math.log2(span))
  const mant = f32(span / Math.pow(2, se))
  const legacy: PixelResult[] = []
  const fexp: PixelResult[] = []
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const dcm = pixelDcMant(i, j, mant)
      legacy.push(legacyPixel(pair, maxRefIter, dcm, se, MAX_ITER))
      fexp.push(floatexpPixel(quad, maxRefIter, dcm, se, MAX_ITER))
    }
  }

  const sLegacy = compare(truth, legacy)
  const sFexp = compare(truth, fexp)
  const stats = compare(truth, truth)

  console.log(`\n— period ${period}: span ≈ ${span.toExponential(3)} (log2 Λ = ${log2Lambda})`)
  console.log(
    `  truth: ${stats.escapedTruth} escaped / ${stats.interiorTruth} interior, ` +
      `${stats.distinctEsc} distinct escape counts`,
  )
  report("legacy ", sLegacy)
  report("floatexp", sFexp)

  // URL hash for in-browser verification at this exact location.
  const digits = Math.max(20, Math.ceil(-Math.log10(span)) + 12)
  const re = toDecimalString(c, frac, digits)
  console.log(`  hash: #s=${span.toExponential(6)}&it=2048&ch=${re},0`)

  return { legacyOk: sLegacy.classMismatch === 0 && sLegacy.maxDl < 0.5, fexpOk: sFexp.classMismatch === 0 && sFexp.maxDl < 0.5 }
}

function report(name: string, s: Summary) {
  const verdict = s.classMismatch === 0 && s.maxDl < 0.5 ? "MATCH" : "MISMATCH"
  console.log(
    `  ${name}: ${verdict} — class mismatches ${s.classMismatch}/${GRID * GRID}, ` +
      `max |Δl| ${s.maxDl.toFixed(4)}`,
  )
}

function pixelDcMant(i: number, j: number, mant: number): V2 {
  // Mirrors the shader: p = (fragCoord − 0.5·res)/res.x, bias = 0.
  const px = f32(f32(i + 0.5 - GRID / 2) / GRID)
  const py = f32(f32(j + 0.5 - GRID / 2) / GRID)
  return { x: f32(px * mant), y: f32(py * mant) }
}

function renderTruth(c: Fixed, span: number, frac: number): PixelResult[] {
  const se = Math.floor(Math.log2(span))
  const mant = f32(span / Math.pow(2, se))
  const out: PixelResult[] = []
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const dcm = pixelDcMant(i, j, mant)
      // dc = dcMant·2^se exactly, constructed in fixed-point (a double would
      // underflow at depth).
      const cx = c + fromNumber(dcm.x, frac + se)
      const cy = fromNumber(dcm.y, frac + se)
      out.push(truthPixel(cx, cy, frac, MAX_ITER))
    }
  }
  return out
}

// ---------------------------------------------------------------------------

const K = spikeSeedConstant()
console.log(`spike seed constant K = ${K.toFixed(6)} (ε_p ≈ K·4^−p)`)

const results: { period: number; legacyOk: boolean; fexpOk: boolean }[] = []
for (const period of [12, 82, 166, 250]) {
  const r = runDepth(period, K)
  results.push({ period, ...r })
}

console.log("\n=== summary ===")
let fail = false
for (const r of results) {
  console.log(
    `period ${String(r.period).padStart(3)}: legacy ${r.legacyOk ? "ok" : "BROKEN"}, ` +
      `floatexp ${r.fexpOk ? "ok" : "BROKEN"}`,
  )
  if (!r.fexpOk) fail = true
}
if (fail) {
  console.error("\nFAIL: floatexp emulation disagrees with ground truth")
  process.exit(1)
}
console.log("\nPASS: floatexp matches ground truth at every depth")
