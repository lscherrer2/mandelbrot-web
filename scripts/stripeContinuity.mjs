// Replicates the direct-tier stripe-average computation from mandelbrot.frag
// in double precision, sampling c along a line so the escape time n steps.
// If the interpolation is correct, the stripe value must be continuous across
// each n-seam (jump magnitude ~ in-band gradient); a formula bug shows up as
// seam jumps far larger than the in-band drift.

const B = 256;
const FREQ = 6;
const MAXIT = 20000;

function stripeAt(cx, cy) {
  let zx = 0, zy = 0;
  let sSum = 0, sLast = 0, sCnt = 0, sFrac = -1;
  let n = 0;
  for (let i = 0; i < MAXIT; i++) {
    const nx = zx * zx - zy * zy + cx;
    const ny = 2 * zx * zy + cy;
    zx = nx; zy = ny;
    const zz = zx * zx + zy * zy;
    if (sFrac < 0) {
      sLast = 0.5 + 0.5 * Math.sin(FREQ * Math.atan2(zy, zx));
      sSum += sLast;
      sCnt += 1;
      if (zz > 16) sFrac = Math.min(1, Math.max(0, 3 - Math.log2(Math.log2(zz))));
    }
    if (zz > B * B) {
      const avgAll = sSum / sCnt;
      const avgPrev = sCnt > 1 ? (sSum - sLast) / (sCnt - 1) : avgAll;
      return {
        n: sCnt, // band id for seam detection = number of accumulated addends
        l: n - Math.log2(Math.log2(zz)) + 4,
        uMix: sFrac,
        stripe: avgPrev + sFrac * (avgAll - avgPrev),
        avgPrev,
        avgAll,
      };
    }
    n += 1;
  }
  return null;
}

// March along a short segment in seahorse valley where iteration counts are
// high; fine enough steps that many samples land in each band.
const c0 = { x: -0.7436438870, y: 0.1318259042 };
const dir = { x: 1e-12, y: 0.7e-12 };
const STEPS = 200000;

let prev = null;
let lastInBandStep = 0;
const seams = [];
for (let i = 0; i <= STEPS; i++) {
  const r = stripeAt(c0.x + dir.x * i, c0.y + dir.y * i);
  if (!r) { prev = null; continue; }
  if (prev) {
    const d = Math.abs(r.stripe - prev.stripe);
    if (r.n === prev.n) {
      lastInBandStep = d;
    } else if (Math.abs(r.n - prev.n) === 1) {
      seams.push({
        i, from: prev.n, to: r.n, jump: d,
        inBand: lastInBandStep,
        uBefore: prev.uMix, uAfter: r.uMix,
      });
    }
  }
  prev = r;
}

console.log("clean |dn|=1 seam crossings:", seams.length);

// Bisect each seam to machine precision and take one-sided limits: the true
// discontinuity of the stripe (and of smooth l, which must be ~0).
function at(t) {
  return stripeAt(c0.x + dir.x * t, c0.y + dir.y * t);
}
const measured = [];
for (const s of seams.slice(0, 200)) {
  let lo = s.i - 1, hi = s.i;
  const nLo = at(lo).n;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (at(mid).n === nLo) lo = mid; else hi = mid;
  }
  const a = at(lo), b = at(hi);
  measured.push({
    from: a.n, to: b.n,
    dStripe: Math.abs(b.stripe - a.stripe),
    dL: Math.abs(b.l - a.l),
    uA: a.uMix, uB: b.uMix,
  });
}
measured.sort((x, y) => y.dStripe - x.dStripe);
console.log("true one-sided seam discontinuities (worst 12):");
for (const m of measured.slice(0, 12))
  console.log(
    `  n ${m.from}->${m.to}  dStripe=${m.dStripe.toExponential(2)}  dL=${m.dL.toExponential(2)}  u ${m.uA.toFixed(4)}->${m.uB.toFixed(4)}`,
  );
const med = measured.map(m => m.dStripe).sort((a, b) => a - b)[Math.floor(measured.length / 2)];
console.log("median dStripe:", med.toExponential(2));
