import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { getDb, THUMBNAIL_DIR } from './db.ts';

type SceneStyle =
  | 'goa_golden_beach'
  | 'goa_sunset_ocean'
  | 'goa_night_dinner'
  | 'goa_night_lantern'
  | 'munnar_lush_tea'
  | 'munnar_forest_canopy'
  | 'munnar_mist_mono'
  | 'mumbai_birthday_warm'
  | 'mumbai_marine_coastal'
  | 'mumbai_marine_mono'
  | 'noise_screenshot'
  | 'noise_home_snapshot';

interface SampleAssetSpec {
  id: string;
  fileName: string;
  originalPath: string;
  localDateTime: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  exifMake: string | null;
  exifModel: string | null;
  width: number;
  height: number;
  isArchived?: boolean;
  isTrashed?: boolean;
  isAlreadyAlbumed?: boolean;
  peopleIds: string[];
  smartTags: string[];
  sceneStyle: SceneStyle;
  seed: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Generates atmospheric 320x240 photographic-grade raster PNG thumbnails with
 * realistic lighting gradients, horizons, reflections, foliage, bokeh, and micro-grain
 * so the real CIELAB K-Means and EMD algorithms operate on authentic pixel distributions.
 */
export function renderScenePng(style: SceneStyle, seed: number, width = 320, height = 240): Buffer {
  const png = new PNG({ width, height });
  const rand = mulberry32(seed * 7919 + 137);
  const vShift = (rand() - 0.5) * 14;
  const sunX = 0.28 + rand() * 0.44;
  const sunY = style === 'goa_sunset_ocean' ? 0.48 + rand() * 0.08 : 0.34 + rand() * 0.12;

  // Pre-generate bokeh / lantern / candle orbs for indoor/night scenes
  const orbs: Array<{ x: number; y: number; r: number; cr: number; cg: number; cb: number; i: number }> = [];
  if (style === 'goa_night_dinner' || style === 'goa_night_lantern' || style === 'mumbai_birthday_warm') {
    const count = style === 'mumbai_birthday_warm' ? 14 : 18;
    for (let k = 0; k < count; k++) {
      const warm = style === 'mumbai_birthday_warm' || k % 3 !== 0;
      orbs.push({
        x: 0.08 + rand() * 0.84,
        y: 0.14 + rand() * 0.62,
        r: 0.03 + rand() * 0.09,
        cr: warm ? 255 : 108,
        cg: warm ? 158 + rand() * 65 : 88 + rand() * 75,
        cb: warm ? 48 + rand() * 40 : 245,
        i: 0.35 + rand() * 0.55,
      });
    }
  }

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const grain = (rand() - 0.5) * 6;
      let r = 128;
      let g = 128;
      let b = 128;

      if (style === 'goa_golden_beach' || style === 'goa_sunset_ocean') {
        const horizon = 0.56 + Math.sin(nx * 4 + seed) * 0.01;
        const dx = nx - sunX;
        const dy = (ny - sunY) * (height / width);
        const sunDist = Math.hypot(dx, dy);
        const sunGlow = Math.exp(-sunDist * 4.5);

        if (ny < horizon) {
          // Golden-amber twilight sky
          const t = ny / horizon;
          r = lerp(96 + vShift, 248, Math.pow(t, 0.8)) + sunGlow * 45;
          g = lerp(112, 166 + vShift * 0.5, Math.pow(t, 0.9)) + sunGlow * 55;
          b = lerp(146, 86, t) + sunGlow * 18;
          // Soft cloud bands
          const cloud = Math.sin(nx * 9 + seed) * Math.cos(ny * 18 + seed * 0.5);
          if (cloud > 0.35 && ny > 0.14 && ny < 0.45) {
            r += 16 * cloud;
            g += 10 * cloud;
          }
        } else if (ny < 0.78) {
          // Ocean shimmer with golden sun reflection
          const t = (ny - horizon) / (0.78 - horizon);
          const ripple = Math.sin(ny * 120 + nx * 18 + seed) * 8;
          const shimmer = Math.exp(-Math.abs(nx - sunX) * (9 - t * 3)) * 95;
          r = lerp(188, 72, t) + shimmer + ripple;
          g = lerp(128, 96, t) + shimmer * 0.72 + ripple * 0.5;
          b = lerp(92, 118, t) + shimmer * 0.25;
        } else {
          // Warm coastal sand
          const t = (ny - 0.78) / 0.22;
          r = lerp(176, 128, t) + vShift * 0.4;
          g = lerp(132, 92, t);
          b = lerp(84, 58, t);
        }

        // Palm silhouette on right or left edge
        const trunkX = seed % 2 === 0 ? 0.86 : 0.14;
        const curve = trunkX + Math.sin(ny * 3.2) * 0.04;
        if (ny > 0.28 && Math.abs(nx - curve) < 0.012 * (0.6 + ny * 0.6)) {
          r *= 0.18;
          g *= 0.18;
          b *= 0.22;
        }
      } else if (style === 'goa_night_dinner' || style === 'goa_night_lantern') {
        // Deep indigo-violet tropical night with vibrant amber/magenta bokeh lights
        r = lerp(14, 34, ny) + vShift * 0.2;
        g = lerp(16, 22, ny);
        b = lerp(42, 62, 1 - ny * 0.5);

        // Table / deck silhouette below
        if (ny > 0.74) {
          r = lerp(46, 24, (ny - 0.74) / 0.26);
          g = lerp(26, 15, (ny - 0.74) / 0.26);
          b = lerp(34, 24, (ny - 0.74) / 0.26);
        }

        for (const o of orbs) {
          const d = Math.hypot(nx - o.x, (ny - o.y) * (height / width));
          if (d < o.r * 2.4) {
            const glow = Math.exp(-(d * d) / (2 * o.r * o.r)) * o.i;
            r += o.cr * glow;
            g += o.cg * glow;
            b += o.cb * glow;
          }
        }
      } else if (style === 'munnar_lush_tea' || style === 'munnar_forest_canopy') {
        const ridge1 = 0.32 + Math.sin(nx * 5.2 + seed) * 0.06;
        const ridge2 = 0.54 + Math.cos(nx * 6.8 + seed * 1.4) * 0.05;
        const ridge3 = 0.74 + Math.sin(nx * 9.5 + seed * 2.1) * 0.035;

        if (ny < ridge1) {
          // Soft highland morning sky
          const t = ny / ridge1;
          r = lerp(148, 206, t);
          g = lerp(196, 228, t);
          b = lerp(188, 208, t);
        } else if (ny < ridge2) {
          // Distant misty emerald slope
          const t = (ny - ridge1) / (ridge2 - ridge1);
          r = lerp(52, 34, t) + vShift * 0.3;
          g = lerp(126, 108, t);
          b = lerp(78, 56, t);
        } else if (ny < ridge3) {
          // Vibrant terraced tea plantation rows
          const terraces = Math.sin(ny * 85 + Math.sin(nx * 8 + seed) * 3) * 14;
          r = 38 + terraces * 0.5;
          g = 122 + terraces + vShift * 0.5;
          b = 46 + terraces * 0.3;
        } else {
          // Foreground deep moss & foliage
          const leaf = Math.sin(nx * 44 + ny * 38 + seed) * 12;
          r = 22 + leaf * 0.4;
          g = 78 + leaf;
          b = 32 + leaf * 0.3;
        }
      } else if (style === 'munnar_mist_mono') {
        // High-contrast foggy monochrome highland ridge
        const ridge1 = 0.38 + Math.sin(nx * 4.5 + seed) * 0.08;
        const ridge2 = 0.62 + Math.cos(nx * 7.2 + seed * 0.8) * 0.06;
        let lum = 212;
        if (ny < ridge1) {
          lum = lerp(228, 192, ny / ridge1) + vShift * 0.4;
        } else if (ny < ridge2) {
          const mist = Math.sin(nx * 6 + ny * 12 + seed) * 14;
          lum = lerp(128, 86, (ny - ridge1) / (ridge2 - ridge1)) + mist;
        } else {
          lum = lerp(64, 28, (ny - ridge2) / (1 - ridge2));
        }
        r = lum;
        g = lum;
        b = lum + 2; // subtle silver gelatin cool tint
      } else if (style === 'mumbai_birthday_warm') {
        // Warm indoor tungsten dining room & birthday candlelight glow
        r = lerp(52, 88, 1 - ny) + vShift * 0.3;
        g = lerp(28, 44, 1 - ny);
        b = lerp(18, 22, 1 - ny);

        // Central warm candle cluster glow
        const cd = Math.hypot(nx - 0.5, (ny - 0.58) * (height / width));
        const candle = Math.exp(-cd * 4.2);
        r += candle * 175;
        g += candle * 112;
        b += candle * 38;

        for (const o of orbs) {
          const d = Math.hypot(nx - o.x, (ny - o.y) * (height / width));
          if (d < o.r * 2.2) {
            const glow = Math.exp(-(d * d) / (2 * o.r * o.r)) * o.i * 0.7;
            r += o.cr * glow;
            g += o.cg * glow;
            b += o.cb * glow;
          }
        }
      } else if (style === 'mumbai_marine_coastal') {
        // Crisp bright Arabian Sea afternoon promenade
        const horizon = 0.52;
        if (ny < horizon) {
          const t = ny / horizon;
          r = lerp(94, 186, t);
          g = lerp(164, 218, t);
          b = lerp(228, 242, t);
        } else if (ny < 0.74) {
          const t = (ny - horizon) / 0.22;
          const wave = Math.sin(ny * 90 + nx * 12 + seed) * 7;
          r = lerp(62, 46, t) + wave;
          g = lerp(138, 118, t) + wave;
          b = lerp(186, 168, t) + wave;
        } else {
          // Art-deco promenade stone pavement
          const grid = (Math.floor(nx * 16) + Math.floor(ny * 12)) % 2 === 0 ? 8 : -6;
          r = 178 + grid;
          g = 182 + grid;
          b = 184 + grid;
        }
      } else if (style === 'mumbai_marine_mono') {
        // Architectural monochrome colonnade & shadows
        const pillar = Math.abs(Math.sin(nx * 18 + seed * 0.3));
        const shadow = ny > 0.65 ? (nx * 0.5 + 0.3) : 1;
        const lum = pillar > 0.75 ? 42 : lerp(218, 134, ny) * shadow;
        r = lum;
        g = lum;
        b = lum;
      } else if (style === 'noise_screenshot') {
        // Clean flat UI screenshot appearance (uniform light card + header bar)
        if (ny < 0.12) {
          r = 32;
          g = 42;
          b = 58;
        } else if (nx > 0.1 && nx < 0.9 && ny > 0.22 && ny < 0.42) {
          r = 226;
          g = 232;
          b = 240;
        } else if (nx > 0.1 && nx < 0.75 && ny > 0.5 && ny < 0.58) {
          r = 148;
          g = 163;
          b = 184;
        } else {
          r = 248;
          g = 250;
          b = 252;
        }
      } else {
        // Neutral home snapshot
        r = lerp(154, 112, ny) + vShift;
        g = lerp(146, 116, ny);
        b = lerp(138, 118, ny);
      }

      const idx = (width * y + x) << 2;
      png.data[idx] = clampByte(r + grain);
      png.data[idx + 1] = clampByte(g + grain);
      png.data[idx + 2] = clampByte(b + grain);
      png.data[idx + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

function buildSampleCatalog(): SampleAssetSpec[] {
  const items: SampleAssetSpec[] = [];

  // ---------------------------------------------------------------------------
  // 1. Home-Base Anchor Snapshots (Mumbai, ~19.0760, 72.8777) — establishes 5km Home Base
  //    Plus household faces (person_self, person_partner) appearing across many days.
  // ---------------------------------------------------------------------------
  const homeDates = [
    '2026-09-04T09:15:00Z',
    '2026-09-11T18:20:00Z',
    '2026-09-19T11:05:00Z',
    '2026-09-27T17:45:00Z',
    '2026-10-03T08:40:00Z',
    '2026-10-12T19:10:00Z',
    '2026-10-25T13:30:00Z',
    '2026-11-02T10:15:00Z',
  ];
  homeDates.forEach((dt, i) => {
    items.push({
      id: `asset-home-anchor-${i + 1}`,
      fileName: `IMG_HOME_${1040 + i}.JPG`,
      originalPath: `/library/2026/Camera/IMG_HOME_${1040 + i}.JPG`,
      localDateTime: dt,
      city: 'Mumbai',
      country: 'India',
      latitude: 19.076 + (i % 3) * 0.002,
      longitude: 72.8777 + (i % 2) * 0.002,
      exifMake: 'Apple',
      exifModel: 'iPhone 16 Pro',
      width: 4032,
      height: 3024,
      peopleIds: i % 2 === 0 ? ['person_self', 'person_partner'] : ['person_self'],
      smartTags: ['home', 'daily life'],
      sceneStyle: 'noise_home_snapshot',
      seed: 100 + i,
    });
  });

  // ---------------------------------------------------------------------------
  // 2. MACRO TRIP #1: Goa Coastal Trip (Nov 14–15, 2026) — 18 photos
  //    Chapter A: 10 Beach & Golden Hour photos (16:40–17:52)
  //    48-minute gap + dramatic CIELAB lightness/temperature shift ->
  //    Chapter B: 8 Nightlife & Dinner photos (18:40–21:15)
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 10; i++) {
    const mins = 40 + i * 7;
    const hr = 16 + Math.floor(mins / 60);
    const mm = mins % 60;
    items.push({
      id: `asset-goa-beach-${i + 1}`,
      fileName: `DSC_GOA_${3001 + i}.JPG`,
      originalPath: `/library/2026/11-Goa/DSC_GOA_${3001 + i}.JPG`,
      localDateTime: `2026-11-14T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:12Z`,
      city: 'Goa',
      country: 'India',
      latitude: 15.555 + i * 0.0004,
      longitude: 73.751 + i * 0.0003,
      exifMake: 'Sony',
      exifModel: 'ILCE-7M4',
      width: 6000,
      height: 4000,
      peopleIds: i % 2 === 0 ? ['person_self', 'person_partner'] : ['person_self'],
      smartTags: ['beach', 'sunset', 'ocean', 'coast'],
      sceneStyle: i % 2 === 0 ? 'goa_golden_beach' : 'goa_sunset_ocean',
      seed: 200 + i,
    });
  }

  for (let i = 0; i < 8; i++) {
    const totalMins = 18 * 60 + 48 + i * 16;
    const hr = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    items.push({
      id: `asset-goa-night-${i + 1}`,
      fileName: `DSC_GOA_${3040 + i}.JPG`,
      originalPath: `/library/2026/11-Goa/DSC_GOA_${3040 + i}.JPG`,
      localDateTime: `2026-11-14T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:05Z`,
      city: 'Goa',
      country: 'India',
      latitude: 15.558 + i * 0.0002,
      longitude: 73.754 + i * 0.0002,
      exifMake: 'Sony',
      exifModel: 'ILCE-7M4',
      width: 6000,
      height: 4000,
      peopleIds: ['person_self', 'person_partner', 'person_kabir'],
      smartTags: ['dinner', 'nightlife', 'restaurant', 'lanterns'],
      sceneStyle: i % 2 === 0 ? 'goa_night_dinner' : 'goa_night_lantern',
      seed: 250 + i,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. MACRO TRIP #2: Munnar Highland Trek (Oct 17–18, 2026) — 16 photos
  //    Chapter A: 9 Lush Nature Tea Estate & Forest Canopy photos (08:15–09:40)
  //    58-minute gap + shift to misty monochrome ridge ->
  //    Chapter B: 7 Monochrome Highland Mist photos (10:38–11:50)
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 9; i++) {
    const totalMins = 8 * 60 + 15 + i * 9;
    const hr = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    items.push({
      id: `asset-munnar-lush-${i + 1}`,
      fileName: `FX_MUNNAR_${510 + i}.JPG`,
      originalPath: `/library/2026/10-Munnar/FX_MUNNAR_${510 + i}.JPG`,
      localDateTime: `2026-10-17T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:22Z`,
      city: 'Munnar',
      country: 'India',
      latitude: 10.0889 + i * 0.0005,
      longitude: 77.0595 + i * 0.0004,
      exifMake: 'FUJIFILM',
      exifModel: 'X-T5',
      width: 6240,
      height: 4160,
      peopleIds: ['person_self', 'person_partner'],
      smartTags: ['hiking', 'mountains', 'forest', 'tea plantation'],
      sceneStyle: i % 2 === 0 ? 'munnar_lush_tea' : 'munnar_forest_canopy',
      seed: 300 + i,
    });
  }

  for (let i = 0; i < 7; i++) {
    const totalMins = 10 * 60 + 42 + i * 11;
    const hr = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    items.push({
      id: `asset-munnar-mist-${i + 1}`,
      fileName: `FX_MUNNAR_${545 + i}.JPG`,
      originalPath: `/library/2026/10-Munnar/FX_MUNNAR_${545 + i}.JPG`,
      localDateTime: `2026-10-17T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:40Z`,
      city: 'Munnar',
      country: 'India',
      latitude: 10.095 + i * 0.0003,
      longitude: 77.064 + i * 0.0003,
      exifMake: 'FUJIFILM',
      exifModel: 'X-T5',
      width: 6240,
      height: 4160,
      peopleIds: ['person_self'],
      smartTags: ['hiking', 'fog', 'monochrome', 'summit'],
      sceneStyle: 'munnar_mist_mono',
      seed: 340 + i,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. LOCAL HOME-CITY EVENT #1: Birthday Celebration in Mumbai (Nov 08, 2026) — 10 photos
  //    Inside the 5km Mumbai home base! Discovered via timestamp density + fine 100m GPS
  //    + recurring non-household faces (person_ananya, person_rohan, person_meera).
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 10; i++) {
    const totalMins = 19 * 60 + 20 + i * 12;
    const hr = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    items.push({
      id: `asset-mumbai-bday-${i + 1}`,
      fileName: `IMG_BDAY_${8201 + i}.JPG`,
      originalPath: `/library/2026/Camera/IMG_BDAY_${8201 + i}.JPG`,
      localDateTime: `2026-11-08T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:18Z`,
      city: 'Mumbai',
      country: 'India',
      latitude: 19.0782 + (i % 3) * 0.00005,
      longitude: 72.8761 + (i % 2) * 0.00004,
      exifMake: 'Apple',
      exifModel: 'iPhone 16 Pro',
      width: 4032,
      height: 3024,
      peopleIds: ['person_self', 'person_ananya', 'person_rohan', 'person_meera'],
      smartTags: ['birthday cake', 'celebration', 'dinner', 'friends'],
      sceneStyle: 'mumbai_birthday_warm',
      seed: 400 + i,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. LOCAL HOME-CITY EVENT #2: Marine Drive Promenade Walk (Oct 29, 2026) — 8 photos
  //    Inside Mumbai home radius, tight 100m GPS & timestamp burst.
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 8; i++) {
    const totalMins = 16 * 60 + 10 + i * 8;
    const hr = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    items.push({
      id: `asset-mumbai-walk-${i + 1}`,
      fileName: `L100_${901 + i}.JPG`,
      originalPath: `/library/2026/Camera/L100_${901 + i}.JPG`,
      localDateTime: `2026-10-29T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:09Z`,
      city: 'Mumbai',
      country: 'India',
      latitude: 19.064 + i * 0.00012,
      longitude: 72.869 + i * 0.00008,
      exifMake: 'Leica',
      exifModel: 'Q3',
      width: 6000,
      height: 4000,
      peopleIds: ['person_self', 'person_vikram'],
      smartTags: ['architecture', 'promenade', 'coast', 'street'],
      sceneStyle: i < 5 ? 'mumbai_marine_coastal' : 'mumbai_marine_mono',
      seed: 460 + i,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. STAGE 1 FILTER EXAMPLES: Screenshots, WhatsApp forwards, Archived & Already-Albumed
  // ---------------------------------------------------------------------------
  items.push(
    {
      id: 'asset-filter-shot-1',
      fileName: 'Screenshot_20261112_142211.png',
      originalPath: '/library/2026/Screenshots/Screenshot_20261112_142211.png',
      localDateTime: '2026-11-12T14:22:11Z',
      city: 'Mumbai',
      country: 'India',
      latitude: null,
      longitude: null,
      exifMake: null,
      exifModel: null,
      width: 1179,
      height: 2556,
      peopleIds: [],
      smartTags: ['document', 'screen'],
      sceneStyle: 'noise_screenshot',
      seed: 901,
    },
    {
      id: 'asset-filter-shot-2',
      fileName: 'IMG_9912.PNG',
      originalPath: '/library/2026/Camera/IMG_9912.PNG',
      localDateTime: '2026-11-13T09:10:04Z',
      city: null,
      country: null,
      latitude: null,
      longitude: null,
      exifMake: null,
      exifModel: null,
      width: 1290,
      height: 2796,
      peopleIds: [],
      smartTags: ['receipt'],
      sceneStyle: 'noise_screenshot',
      seed: 902,
    },
    {
      id: 'asset-filter-wa-1',
      fileName: 'IMG-20261110-WA0042.jpg',
      originalPath: '/library/WhatsApp/Media/IMG-20261110-WA0042.jpg',
      localDateTime: '2026-11-10T12:18:00Z',
      city: 'Mumbai',
      country: 'India',
      latitude: 19.076,
      longitude: 72.877,
      exifMake: null,
      exifModel: null,
      width: 1280,
      height: 960,
      peopleIds: [],
      smartTags: ['meme'],
      sceneStyle: 'noise_screenshot',
      seed: 903,
    },
    {
      id: 'asset-filter-dl-1',
      fileName: 'boarding_pass_goa.jpg',
      originalPath: '/library/Downloads/boarding_pass_goa.jpg',
      localDateTime: '2026-11-14T06:15:00Z',
      city: 'Mumbai',
      country: 'India',
      latitude: 19.089,
      longitude: 72.865,
      exifMake: null,
      exifModel: null,
      width: 1080,
      height: 1920,
      peopleIds: [],
      smartTags: ['ticket'],
      sceneStyle: 'noise_screenshot',
      seed: 904,
    },
    {
      id: 'asset-filter-archived-1',
      fileName: 'IMG_ARCHIVE_01.JPG',
      originalPath: '/library/2026/Camera/IMG_ARCHIVE_01.JPG',
      localDateTime: '2026-10-08T11:30:00Z',
      city: 'Mumbai',
      country: 'India',
      latitude: 19.075,
      longitude: 72.878,
      exifMake: 'Apple',
      exifModel: 'iPhone 16 Pro',
      width: 4032,
      height: 3024,
      isArchived: true,
      peopleIds: [],
      smartTags: ['document'],
      sceneStyle: 'noise_home_snapshot',
      seed: 905,
    },
    {
      id: 'asset-filter-albumed-1',
      fileName: 'IMG_MANUAL_CURATED_01.JPG',
      originalPath: '/library/2026/Camera/IMG_MANUAL_CURATED_01.JPG',
      localDateTime: '2026-10-14T15:00:00Z',
      city: 'Mumbai',
      country: 'India',
      latitude: 19.076,
      longitude: 72.877,
      exifMake: 'Sony',
      exifModel: 'ILCE-7M4',
      width: 6000,
      height: 4000,
      isAlreadyAlbumed: true,
      peopleIds: ['person_self'],
      smartTags: ['portrait'],
      sceneStyle: 'goa_golden_beach',
      seed: 906,
    }
  );

  return items;
}

export function seedSampleLibraryIfEmpty(forceReset = false): number {
  const db = getDb();
  const countRow = db.prepare('SELECT COUNT(*) as c FROM assets').get() as { c: number };
  if (countRow.c > 0 && !forceReset) {
    return 0;
  }

  if (forceReset) {
    db.prepare('DELETE FROM assets').run();
    db.prepare('DELETE FROM clusters').run();
    db.prepare('DELETE FROM sync_mappings').run();
    db.prepare('DELETE FROM sync_history').run();
    db.prepare("DELETE FROM app_state WHERE key = 'pipeline_summary'").run();
  }

  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  const catalog = buildSampleCatalog();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO assets (
      id, source, file_name, original_path, local_date_time,
      city, country, latitude, longitude, exif_make, exif_model,
      width, height, is_archived, is_trashed, is_already_albumed,
      is_screenshot, excluded_reason, people_ids_json, smart_tags_json,
      thumbnail_file, created_at
    ) VALUES (
      @id, 'sample', @file_name, @original_path, @local_date_time,
      @city, @country, @latitude, @longitude, @exif_make, @exif_model,
      @width, @height, @is_archived, @is_trashed, @is_already_albumed,
      0, NULL, @people_ids_json, @smart_tags_json,
      @thumbnail_file, @created_at
    )
  `);

  const tx = db.transaction(() => {
    for (const spec of catalog) {
      const thumbFile = `${spec.id}.png`;
      const fullPath = path.join(THUMBNAIL_DIR, thumbFile);
      if (!fs.existsSync(fullPath)) {
        const buf = renderScenePng(spec.sceneStyle, spec.seed, 320, 240);
        fs.writeFileSync(fullPath, buf);
      }

      insert.run({
        id: spec.id,
        file_name: spec.fileName,
        original_path: spec.originalPath,
        local_date_time: spec.localDateTime,
        city: spec.city,
        country: spec.country,
        latitude: spec.latitude,
        longitude: spec.longitude,
        exif_make: spec.exifMake,
        exif_model: spec.exifModel,
        width: spec.width,
        height: spec.height,
        is_archived: spec.isArchived ? 1 : 0,
        is_trashed: spec.isTrashed ? 1 : 0,
        is_already_albumed: spec.isAlreadyAlbumed ? 1 : 0,
        people_ids_json: JSON.stringify(spec.peopleIds),
        smart_tags_json: JSON.stringify(spec.smartTags),
        thumbnail_file: thumbFile,
        created_at: now,
      });
    }
  });

  tx();
  return catalog.length;
}

/**
 * Simulates newly uploaded photos from an ongoing Goa trip arriving in Immich,
 * demonstrating incremental SQLite feature caching and idempotent PUT /albums/{id}/assets appends.
 */
export function appendIncrementalTripPhotos(): number {
  const db = getDb();
  const existing = db
    .prepare("SELECT COUNT(*) as c FROM assets WHERE id LIKE 'asset-goa-extra-%'")
    .get() as { c: number };
  const batchStart = existing.c + 1;
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO assets (
      id, source, file_name, original_path, local_date_time,
      city, country, latitude, longitude, exif_make, exif_model,
      width, height, is_archived, is_trashed, is_already_albumed,
      is_screenshot, excluded_reason, people_ids_json, smart_tags_json,
      thumbnail_file, created_at
    ) VALUES (
      @id, 'sample', @file_name, @original_path, @local_date_time,
      'Goa', 'India', @latitude, @longitude, 'Sony', 'ILCE-7M4',
      6000, 4000, 0, 0, 0,
      0, NULL, @people_ids_json, @smart_tags_json,
      @thumbnail_file, @created_at
    )
  `);

  const count = 3;
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const idx = batchStart + i;
      const id = `asset-goa-extra-${idx}`;
      const thumbFile = `${id}.png`;
      const fullPath = path.join(THUMBNAIL_DIR, thumbFile);
      const buf = renderScenePng('goa_sunset_ocean', 700 + idx * 13, 320, 240);
      fs.writeFileSync(fullPath, buf);

      const minute = 52 + idx;
      const hr = 17 + Math.floor(minute / 60);
      const mm = minute % 60;

      insert.run({
        id,
        file_name: `DSC_GOA_NEW_${3100 + idx}.JPG`,
        original_path: `/library/2026/11-Goa/DSC_GOA_NEW_${3100 + idx}.JPG`,
        local_date_time: `2026-11-14T${String(hr).padStart(2, '0')}:${String(mm).padStart(2, '0')}:30Z`,
        latitude: 15.5565 + idx * 0.0002,
        longitude: 73.7525 + idx * 0.0002,
        people_ids_json: JSON.stringify(['person_self', 'person_partner']),
        smart_tags_json: JSON.stringify(['beach', 'sunset', 'ocean']),
        thumbnail_file: thumbFile,
        created_at: now,
      });
    }
  });

  tx();
  return count;
}
