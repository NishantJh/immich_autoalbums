import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { AestheticMood, LabHistogram, LabMean, PaletteSwatch } from '../shared/types.ts';

export interface LabTriple {
  l: number;
  a: number;
  b: number;
}

export interface ExtractedColorFeatures {
  avgLab: LabMean;
  histogram: LabHistogram;
  palette: PaletteSwatch[];
}

function srgbChannelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(v: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  const s = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, s * 255)));
}

/**
 * Converts sRGB (0-255) to perceptual CIE L*a*b* using D65 reference illuminant.
 */
export function rgbToLab(r: number, g: number, b: number): LabTriple {
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);

  // sRGB to XYZ (D65)
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) / 1.0;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const inv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const x = inv(fx) * 0.95047;
  const y = inv(fy) * 1.0;
  const z = inv(fz) * 1.08883;

  const rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const gl = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return [linearToSrgbChannel(rl), linearToSrgbChannel(gl), linearToSrgbChannel(bl)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function decodeImageBufferToRgba(
  buffer: Buffer,
  mimeHint?: string
): { data: Uint8Array; width: number; height: number } {
  const isPng =
    (buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47) ||
    mimeHint === 'image/png';

  if (isPng) {
    const parsed = PNG.sync.read(buffer);
    return {
      data: new Uint8Array(parsed.data),
      width: parsed.width,
      height: parsed.height,
    };
  }

  const isJpeg =
    (buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) ||
    mimeHint === 'image/jpeg';

  if (!isJpeg) {
    throw new Error('Unsupported thumbnail encoding (expected JPEG or PNG)');
  }

  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  return {
    data: decoded.data,
    width: decoded.width,
    height: decoded.height,
  };
}

function labDistSq(p: LabTriple, q: LabTriple): number {
  const dl = p.l - q.l;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return dl * dl + da * da + db * db;
}

/**
 * Deterministic K-Means++ in CIELAB color space for dominant 5-color swatch extraction.
 */
function runLabKMeans(samples: LabTriple[], k = 5, maxIterations = 12): PaletteSwatch[] {
  if (samples.length === 0) {
    return [];
  }

  // Deterministic K-Means++ initialization
  const centroids: LabTriple[] = [];
  centroids.push({ ...samples[Math.floor(samples.length * 0.5)] });

  for (let c = 1; c < k; c++) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < samples.length; i++) {
      let minD = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const d = labDistSq(samples[i], centroids[j]);
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        bestIdx = i;
      }
    }
    centroids.push({ ...samples[bestIdx] });
  }

  const assignments = new Int32Array(samples.length);
  const counts = new Int32Array(k);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    counts.fill(0);
    const sumL = new Float64Array(k);
    const sumA = new Float64Array(k);
    const sumB = new Float64Array(k);

    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = labDistSq(p, centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
      counts[bestC]++;
      sumL[bestC] += p.l;
      sumA[bestC] += p.a;
      sumB[bestC] += p.b;
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = {
          l: sumL[c] / counts[c],
          a: sumA[c] / counts[c],
          b: sumB[c] / counts[c],
        };
      }
    }
    if (!changed) break;
  }

  const total = samples.length;
  const swatches: PaletteSwatch[] = centroids
    .map((cent, idx) => {
      const [r, g, b] = labToRgb(cent.l, cent.a, cent.b);
      return {
        hex: rgbToHex(r, g, b),
        l: Number(cent.l.toFixed(1)),
        a: Number(cent.a.toFixed(1)),
        b: Number(cent.b.toFixed(1)),
        weight: Number((counts[idx] / total).toFixed(3)),
      };
    })
    .filter((s) => s.weight > 0)
    .sort((x, y) => y.weight - x.weight);

  return swatches;
}

/**
 * Extracts perceptual CIELAB mean, 12-bin channel histograms, and 5-color K-Means palette.
 */
export function extractColorFeaturesFromPixels(
  rgba: Uint8Array,
  width: number,
  height: number
): ExtractedColorFeatures {
  const bins = 12;
  const histL = new Array<number>(bins).fill(0);
  const histA = new Array<number>(bins).fill(0);
  const histB = new Array<number>(bins).fill(0);

  const totalPixels = width * height;
  const targetSamples = 900;
  const stride = Math.max(1, Math.floor(totalPixels / targetSamples));

  const samples: LabTriple[] = [];
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;

  for (let p = 0; p < totalPixels; p += stride) {
    const idx = p * 4;
    const alpha = rgba[idx + 3];
    if (alpha < 30) continue;

    const lab = rgbToLab(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
    samples.push(lab);
    sumL += lab.l;
    sumA += lab.a;
    sumB += lab.b;

    const bl = Math.max(0, Math.min(bins - 1, Math.floor((lab.l / 100) * bins)));
    const ba = Math.max(0, Math.min(bins - 1, Math.floor(((lab.a + 80) / 160) * bins)));
    const bb = Math.max(0, Math.min(bins - 1, Math.floor(((lab.b + 80) / 160) * bins)));
    histL[bl]++;
    histA[ba]++;
    histB[bb]++;
  }

  const n = Math.max(1, samples.length);
  for (let i = 0; i < bins; i++) {
    histL[i] = Number((histL[i] / n).toFixed(4));
    histA[i] = Number((histA[i] / n).toFixed(4));
    histB[i] = Number((histB[i] / n).toFixed(4));
  }

  const meanL = sumL / n;
  const meanA = sumA / n;
  const meanB = sumB / n;
  const chroma = Math.sqrt(meanA * meanA + meanB * meanB);

  const palette = runLabKMeans(samples, 5, 12);

  return {
    avgLab: {
      l: Number(meanL.toFixed(2)),
      a: Number(meanA.toFixed(2)),
      b: Number(meanB.toFixed(2)),
      chroma: Number(chroma.toFixed(2)),
    },
    histogram: { l: histL, a: histA, b: histB },
    palette,
  };
}

export function averageHistograms(histograms: LabHistogram[]): LabHistogram {
  const bins = 12;
  const out: LabHistogram = {
    l: new Array(bins).fill(0),
    a: new Array(bins).fill(0),
    b: new Array(bins).fill(0),
  };
  if (histograms.length === 0) return out;
  for (const h of histograms) {
    for (let i = 0; i < bins; i++) {
      out.l[i] += h.l[i] ?? 0;
      out.a[i] += h.a[i] ?? 0;
      out.b[i] += h.b[i] ?? 0;
    }
  }
  const n = histograms.length;
  for (let i = 0; i < bins; i++) {
    out.l[i] /= n;
    out.a[i] /= n;
    out.b[i] /= n;
  }
  return out;
}

/**
 * 1D Earth Mover's Distance (Wasserstein-1) between two normalized histograms.
 */
function wasserstein1D(p: number[], q: number[]): number {
  const n = Math.min(p.length, q.length);
  if (n === 0) return 0;
  let cdfDiff = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    cdfDiff += (p[i] ?? 0) - (q[i] ?? 0);
    total += Math.abs(cdfDiff);
  }
  return total / n;
}

/**
 * Perceptual CIELAB Earth Mover's Distance normalized to [0, 1] scale.
 */
export function computeLabHistogramEmd(h1: LabHistogram, h2: LabHistogram): number {
  const emdL = wasserstein1D(h1.l, h2.l);
  const emdA = wasserstein1D(h1.a, h2.a);
  const emdB = wasserstein1D(h1.b, h2.b);
  // Weighted perceptual shift (lightness + warm-cool b* axis + green-magenta a* axis)
  const score = (0.45 * emdL + 0.25 * emdA + 0.30 * emdB) * 3.2;
  return Number(Math.min(1, score).toFixed(3));
}

/**
 * Aggregates multiple asset palettes into a unified 5-color cluster palette via CIELAB K-Means.
 */
export function mergePalettesToFive(palettes: PaletteSwatch[][]): PaletteSwatch[] {
  const weightedSamples: LabTriple[] = [];
  for (const pal of palettes) {
    for (const s of pal) {
      const reps = Math.max(1, Math.round(s.weight * 20));
      for (let i = 0; i < reps; i++) {
        weightedSamples.push({ l: s.l, a: s.a, b: s.b });
      }
    }
  }
  if (weightedSamples.length === 0) return [];
  return runLabKMeans(weightedSamples, 5, 14);
}

/**
 * Classifies dominant aesthetic mood from cluster mean CIELAB coordinates and palette spread.
 */
export function classifyAestheticMood(avgLab: LabMean, palette: PaletteSwatch[]): AestheticMood {
  const avgChroma =
    palette.length > 0
      ? palette.reduce((acc, s) => acc + Math.hypot(s.a, s.b) * s.weight, 0)
      : avgLab.chroma;

  if (avgChroma < 8.5) {
    return 'Monochrome';
  }
  if (avgLab.l < 34) {
    if (avgLab.b > 12 && avgLab.a > 6) {
      return 'Warm Indoor';
    }
    return 'Vibrant Night';
  }
  if (avgLab.a < -8 && avgLab.b > 4) {
    return 'Lush Nature';
  }
  if (avgLab.b > 16 && avgLab.l >= 38) {
    return 'Golden Hour';
  }
  if (avgLab.b < -4 && avgLab.l >= 48) {
    return 'Coastal Daylight';
  }
  if (avgLab.b > 10 && avgLab.a > 5) {
    return 'Warm Indoor';
  }
  return 'Balanced Daylight';
}
