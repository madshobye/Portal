// -------------------------------------------------------------
// Simplex Noise (1D / 2D / 3D) — fast, smooth, branch-light
// Plain JS (no modules), all functions prefixed with "p".
// Global range mapping via pSetNoiseRange(min, max).
// -------------------------------------------------------------

// ===== Global config =====
let P_NOISE_SEED = 0x12345678 >>> 0;
let P_NOISE_MIN  = 0.0;
let P_NOISE_MAX  = 1.0;

// Change seed (number or string)
function pSetNoiseSeed(seed) {
  if (typeof seed === "string") {
    // FNV-1a string hash
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    P_NOISE_SEED = h >>> 0;
  } else {
    P_NOISE_SEED = (seed >>> 0) || 0;
  }
}

// Globally set output range
function pSetNoiseRange(min, max) {
  P_NOISE_MIN = +min;
  P_NOISE_MAX = +max;
}

// ===== Core helpers =====
function pHash32(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function pHash1D(ix, seed) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h ^= (ix >>> 0) + ((h << 6) >>> 0) + (h >>> 2);
  return pHash32(h);
}
function pHash2D(ix, iy, seed) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h ^= (ix >>> 0) + ((h << 6) >>> 0) + (h >>> 2);
  h ^= 0x9e3779b9 + (iy >>> 0) + ((h << 6) >>> 0) + (h >>> 2);
  return pHash32(h);
}
function pHash3D(ix, iy, iz, seed) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h ^= (ix >>> 0) + ((h << 6) >>> 0) + (h >>> 2);
  h ^= 0x9e3779b9 + (iy >>> 0) + ((h << 6) >>> 0) + (h >>> 2);
  h ^= 0x9e3779b9 + (iz >>> 0) + ((h << 6) >>> 0) + (h >>> 2);
  return pHash32(h);
}

function pFade(t) { return t * t * t * (t * (t * 6 - 15) + 10); } // not used by simplex, kept for convenience
function pLerp(a, b, t) { return a + t * (b - a); }
function pMapToRange(nm1to1) {
  // Map from [-1,1] to [min,max]
  const t = 0.5 * (nm1to1 + 1.0);
  return P_NOISE_MIN + t * (P_NOISE_MAX - P_NOISE_MIN);
}

// ===== Gradient sets =====
const P_INV_SQRT2 = 0.7071067811865476;

// 2D: 8 directions (cardinals + diagonals normalized)
const P_GRADS_2D = new Float32Array([
  1, 0,  -1, 0,   0, 1,   0,-1,
  P_INV_SQRT2,  P_INV_SQRT2,  -P_INV_SQRT2,  P_INV_SQRT2,
  P_INV_SQRT2, -P_INV_SQRT2,  -P_INV_SQRT2, -P_INV_SQRT2
]);

// 3D: 12 classic Perlin directions, normalized by 1/sqrt(2)
const P_GRADS_3D = new Float32Array([
  1, 1, 0,  -1, 1, 0,   1,-1, 0,  -1,-1, 0,
  1, 0, 1,  -1, 0, 1,   1, 0,-1,  -1, 0,-1,
  0, 1, 1,   0,-1, 1,   0, 1,-1,   0,-1,-1
]);
for (let i = 0; i < P_GRADS_3D.length; i++) P_GRADS_3D[i] *= P_INV_SQRT2;

// =============================================================
// 1D Simplex Noise
// =============================================================
// Constants (N=1): F1 = (sqrt(2)-1), G1 = 1 - 1/sqrt(2)
const P_F1 = Math.SQRT2 - 1.0;              // ≈ 0.41421356237309515
const P_G1 = 1.0 - 1.0 / Math.SQRT2;        // ≈ 0.2928932188134524
// Empirical scale to roughly map raw sum to [-1,1]
const P_SIMPLEX1D_SCALE = 2.3;

function pNoise1D(x) {
  // Skew
  const s = x * P_F1;
  const i = Math.floor(x + s);
  const t = i * P_G1;
  const X0 = i - t;
  const x0 = x - X0;
  const x1 = x0 - 1.0 + P_G1;

  // Gradients ±1 from hash LSB
  const g0 = (pHash1D(i,     P_NOISE_SEED) & 1) ?  1 : -1;
  const g1 = (pHash1D(i + 1, P_NOISE_SEED) & 1) ?  1 : -1;

  // Contributions
  let t0 = 0.5 - x0 * x0;
  let n0 = 0.0;
  if (t0 > 0) {
    t0 *= t0; t0 *= t0; // t0^4
    n0 = t0 * (g0 * x0);
  }

  let t1 = 0.5 - x1 * x1;
  let n1 = 0.0;
  if (t1 > 0) {
    t1 *= t1; t1 *= t1;
    n1 = t1 * (g1 * x1);
  }

  const n = (n0 + n1) * P_SIMPLEX1D_SCALE; // ≈ [-1,1]
  return pMapToRange(n);
}

// =============================================================
// 2D Simplex Noise
// =============================================================
const P_F2 = 0.5 * (Math.sqrt(3.0) - 1.0);     // ≈ 0.3660254037844386
const P_G2 = (3.0 - Math.sqrt(3.0)) / 6.0;     // ≈ 0.21132486540518713
const P_SIMPLEX2D_SCALE = 70.0;                 // Gustavson scale to ~[-1,1]

function pNoise2D(x, y = 0) {
  const s = (x + y) * P_F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);

  const t = (i + j) * P_G2;
  const X0 = i - t, Y0 = j - t;
  const x0 = x - X0, y0 = y - Y0;

  // Offsets for middle and last corners
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + P_G2;
  const y1 = y0 - j1 + P_G2;
  const x2 = x0 - 1.0 + 2.0 * P_G2;
  const y2 = y0 - 1.0 + 2.0 * P_G2;

  // Hash -> gradient index (8 choices)
  const h00 = pHash2D(i,     j,     P_NOISE_SEED);
  const h10 = pHash2D(i + i1, j + j1, P_NOISE_SEED);
  const h01 = pHash2D(i + 1, j + 1, P_NOISE_SEED);

  const gi00 = (h00 & 7) << 1;
  const gi10 = (h10 & 7) << 1;
  const gi01 = (h01 & 7) << 1;

  let n0 = 0.0, n1 = 0.0, n2 = 0.0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0; t0 *= t0;
    n0 = t0 * (P_GRADS_2D[gi00] * x0 + P_GRADS_2D[gi00 + 1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1; t1 *= t1;
    n1 = t1 * (P_GRADS_2D[gi10] * x1 + P_GRADS_2D[gi10 + 1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2; t2 *= t2;
    n2 = t2 * (P_GRADS_2D[gi01] * x2 + P_GRADS_2D[gi01 + 1] * y2);
  }

  const n = (n0 + n1 + n2) * P_SIMPLEX2D_SCALE; // ≈ [-1,1]
  return pMapToRange(n);
}

// =============================================================
// 3D Simplex Noise
// =============================================================
const P_F3 = 1.0 / 3.0;    // ≈ 0.3333333333333333
const P_G3 = 1.0 / 6.0;    // ≈ 0.16666666666666666
const P_SIMPLEX3D_SCALE = 32.0; // Gustavson scale to ~[-1,1]

function pNoise3D(x, y = 0, z = 0) {
  const s = (x + y + z) * P_F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);

  const t = (i + j + k) * P_G3;
  const X0 = i - t, Y0 = j - t, Z0 = k - t;
  const x0 = x - X0, y0 = y - Y0, z0 = z - Z0;

  // Order the components to determine simplex corner offsets
  let i1, j1, k1;
  let i2, j2, k2;

  if (x0 >= y0) {
    if (y0 >= z0)      { i1=1; j1=0; k1=0;  i2=1; j2=1; k2=0; }
    else if (x0 >= z0) { i1=1; j1=0; k1=0;  i2=1; j2=0; k2=1; }
    else               { i1=0; j1=0; k1=1;  i2=1; j2=0; k2=1; }
  } else {
    if (y0 < z0)       { i1=0; j1=0; k1=1;  i2=0; j2=1; k2=1; }
    else if (x0 < z0)  { i1=0; j1=1; k1=0;  i2=0; j2=1; k2=1; }
    else               { i1=0; j1=1; k1=0;  i2=1; j2=1; k2=0; }
  }

  const x1 = x0 - i1 + P_G3;
  const y1 = y0 - j1 + P_G3;
  const z1 = z0 - k1 + P_G3;

  const x2 = x0 - i2 + 2.0 * P_G3;
  const y2 = y0 - j2 + 2.0 * P_G3;
  const z2 = z0 - k2 + 2.0 * P_G3;

  const x3 = x0 - 1.0 + 3.0 * P_G3;
  const y3 = y0 - 1.0 + 3.0 * P_G3;
  const z3 = z0 - 1.0 + 3.0 * P_G3;

  // Hash -> gradient (12 choices)
  const h0 = pHash3D(i,           j,           k,           P_NOISE_SEED);
  const h1 = pHash3D(i + i1,      j + j1,      k + k1,      P_NOISE_SEED);
  const h2 = pHash3D(i + i2,      j + j2,      k + k2,      P_NOISE_SEED);
  const h3 = pHash3D(i + 1,       j + 1,       k + 1,       P_NOISE_SEED);

  const gi0 = (h0 % 12) * 3;
  const gi1 = (h1 % 12) * 3;
  const gi2 = (h2 % 12) * 3;
  const gi3 = (h3 % 12) * 3;

  let n0 = 0.0, n1 = 0.0, n2 = 0.0, n3 = 0.0;

  let t0 = 0.5 - x0*x0 - y0*y0 - z0*z0;
  if (t0 > 0) {
    t0 *= t0; t0 *= t0;
    n0 = t0 * (P_GRADS_3D[gi0] * x0 + P_GRADS_3D[gi0 + 1] * y0 + P_GRADS_3D[gi0 + 2] * z0);
  }

  let t1 = 0.5 - x1*x1 - y1*y1 - z1*z1;
  if (t1 > 0) {
    t1 *= t1; t1 *= t1;
    n1 = t1 * (P_GRADS_3D[gi1] * x1 + P_GRADS_3D[gi1 + 1] * y1 + P_GRADS_3D[gi1 + 2] * z1);
  }

  let t2 = 0.5 - x2*x2 - y2*y2 - z2*z2;
  if (t2 > 0) {
    t2 *= t2; t2 *= t2;
    n2 = t2 * (P_GRADS_3D[gi2] * x2 + P_GRADS_3D[gi2 + 1] * y2 + P_GRADS_3D[gi2 + 2] * z2);
  }

  let t3 = 0.5 - x3*x3 - y3*y3 - z3*z3;
  if (t3 > 0) {
    t3 *= t3; t3 *= t3;
    n3 = t3 * (P_GRADS_3D[gi3] * x3 + P_GRADS_3D[gi3 + 1] * y3 + P_GRADS_3D[gi3 + 2] * z3);
  }

  const n = (n0 + n1 + n2 + n3) * P_SIMPLEX3D_SCALE; // ≈ [-1,1]
  return pMapToRange(n);
}

// -------------------------------------------------------------
// Example:
// -------------------------------------------------------------
// pSetNoiseSeed(1337);
// pSetNoiseRange(-0.2, 0.8);     // globally map outputs to [-0.2, 0.8]
// console.log(pNoise1D(12.34));
// console.log(pNoise2D(5.1, 9.7));
// console.log(pNoise3D(2.5, 7.8, 3.3));
