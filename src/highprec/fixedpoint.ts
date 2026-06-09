/**
 * Binary fixed-point arithmetic backed by native `BigInt`.
 *
 * A value `x` is stored as the integer `round(x * 2^FRAC)`. With `FRAC` in the
 * ~1100-bit range this represents complex-plane coordinates to ~300+ decimal
 * digits — enough to resolve individual pixels at a viewport span of 1e-300,
 * which native `double` (≈16 digits) cannot.
 *
 * Only the Mandelbrot *reference orbit* and the *view center* need this
 * precision; everything else stays in hardware float. The hot path here is the
 * reference-orbit step `Z² + C`, run O(iterations) times in a Web Worker.
 *
 * `frac` (the number of fractional bits) is passed explicitly to every op so it
 * can scale with zoom depth — shallow views use fewer bits and run faster.
 */

export type Fixed = bigint

/**
 * Fractional bits used for the *view center* in the store. Fixed (not depth-
 * scaled) so pan/zoom deltas accumulate losslessly across a whole session —
 * 1152 bits ≈ 347 decimal digits, well past the 1e-300 target.
 */
export const FRAC_HP = 1152

/** Fractional bits needed to resolve a pixel at `span` across `px` pixels, with margin. */
export function fracBitsFor(span: number, px: number): number {
  // Need absolute precision ~ span/px, i.e. ceil(log2(px/span)) bits, + margin.
  const needed = Math.log2(px / Math.max(span, Number.MIN_VALUE))
  const bits = Math.ceil(needed) + 32
  // Clamp to a sane band and round up to a multiple of 32.
  const clamped = Math.max(64, Math.min(1152, bits))
  return Math.ceil(clamped / 32) * 32
}

const _buf = new DataView(new ArrayBuffer(8))

/** Exact conversion of a finite `double` into fixed-point with `frac` fractional bits. */
export function fromNumber(x: number, frac: number): Fixed {
  if (x === 0 || !Number.isFinite(x)) return 0n
  _buf.setFloat64(0, x)
  const hi = _buf.getUint32(0)
  const lo = _buf.getUint32(4)
  const sign = hi >>> 31 ? -1n : 1n
  const e = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0)
  let exp: number
  if (e === 0) {
    // subnormal: value = mant * 2^-1074
    exp = -1074
  } else {
    mant |= 1n << 52n // restore implicit leading 1
    exp = e - 1075 // value = mant * 2^(e-1075)
  }
  // fixed = mant * 2^(exp + frac)
  const sh = exp + frac
  const v = sh >= 0 ? mant << BigInt(sh) : mant >> BigInt(-sh)
  return sign < 0n ? -v : v
}

/** Convert fixed-point back to the nearest `double` (handles values far beyond 2^53). */
export function toNumber(v: Fixed, frac: number): number {
  if (v === 0n) return 0
  const neg = v < 0n
  const a = neg ? -v : v
  const bits = a.toString(2).length
  const shift = bits - 53
  const top = shift > 0 ? a >> BigInt(shift) : a << BigInt(-shift)
  const val = Number(top) * Math.pow(2, shift - frac)
  return neg ? -val : val
}

/**
 * Fast conversion to `double` for the orbit hot loop. The fast path extracts
 * the top chunk above 2^-40 — cheap, and plenty for O(1) orbit points. Values
 * below ~2^-10 would keep <30 significant bits that way, so they fall back to
 * the exact conversion. That matters: near-axis deep zooms have reference
 * orbits passing within ~1e-14 of 0, and those close returns must retain full
 * float32 *relative* precision or the GPU's rebasing reads a corrupted
 * reference and renders displaced "glitch" seams.
 */
export function toFloat32(v: Fixed, frac: number): number {
  if (v === 0n) return 0
  const neg = v < 0n
  const a = neg ? -v : v
  const drop = frac - 40
  const scaled = drop > 0 ? Number(a >> BigInt(drop)) : Number(a << BigInt(-drop))
  if (scaled < 0x40000000 /* 2^30 ⇒ |value| < 2^-10 */) return toNumber(v, frac)
  const val = scaled * Math.pow(2, -40)
  return neg ? -val : val
}

const ROUND = (frac: number) => 1n << BigInt(frac - 1)

/** Fixed-point multiply with round-to-nearest. */
export function mul(a: Fixed, b: Fixed, frac: number): Fixed {
  const p = a * b
  return p >= 0n ? (p + ROUND(frac)) >> BigInt(frac) : -((-p + ROUND(frac)) >> BigInt(frac))
}

/**
 * Parse a decimal string (optionally in `1.23e-45` form) into fixed-point.
 * Used to restore deep view coordinates from the URL hash without precision loss.
 */
export function fromDecimalString(s: string, frac: number): Fixed {
  s = s.trim()
  if (!s) return 0n
  let exp = 0
  const eIdx = s.search(/[eE]/)
  if (eIdx >= 0) {
    exp = parseInt(s.slice(eIdx + 1), 10) || 0
    s = s.slice(0, eIdx)
  }
  let neg = false
  if (s[0] === "+") s = s.slice(1)
  else if (s[0] === "-") {
    neg = true
    s = s.slice(1)
  }
  const dot = s.indexOf(".")
  let intDigits = s
  let fracDigits = ""
  if (dot >= 0) {
    intDigits = s.slice(0, dot)
    fracDigits = s.slice(dot + 1)
  }
  // value = (intDigits.fracDigits) * 10^exp
  //       = (intDigits·fracDigits as integer) * 10^(exp - fracDigits.length)
  const mantInt = BigInt((intDigits || "0") + fracDigits)
  const tenExp = exp - fracDigits.length
  // fixed = round( mantInt * 10^tenExp * 2^frac )
  const num = mantInt << BigInt(frac)
  let v: Fixed
  if (tenExp >= 0) {
    v = num * 10n ** BigInt(tenExp)
  } else {
    const den = 10n ** BigInt(-tenExp)
    v = (num + den / 2n) / den // round-to-nearest
  }
  return neg ? -v : v
}

/** Format fixed-point as a plain decimal string with `digits` fractional places. */
export function toDecimalString(v: Fixed, frac: number, digits = 320): string {
  const neg = v < 0n
  const a = neg ? -v : v
  // scaled = round( a * 10^digits / 2^frac )
  const scaled = (a * 10n ** BigInt(digits) + ROUND(frac)) >> BigInt(frac)
  let s = scaled.toString()
  if (s.length <= digits) s = "0".repeat(digits - s.length + 1) + s
  const intPart = s.slice(0, s.length - digits)
  const fracPart = s.slice(s.length - digits).replace(/0+$/, "")
  const sign = neg ? "-" : ""
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`
}
