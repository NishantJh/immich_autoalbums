import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  AestheticMood,
  AssetRecord,
  CandidateHomeBase,
  ClusterRecord,
  ClusterSignalBreakdown,
  EmdTimelinePoint,
  LabHistogram,
  LabMean,
  OrganizerSettings,
  PaletteSwatch,
  PipelineRunSummary,
  Stage1Stats,
  Stage2Stats,
  Stage3Stats,
  SyncHistoryRecord,
} from '../shared/types.ts';
import {
  averageHistograms,
  classifyAestheticMood,
  computeLabHistogramEmd,
  decodeImageBufferToRgba,
  extractColorFeaturesFromPixels,
  mergePalettesToFive,
} from './colorLab.ts';
import {
  getAllAssetsWithHist,
  getAllClusters,
  getDb,
  getSettings,
  savePipelineSummary,
  saveSettings,
  THUMBNAIL_DIR,
} from './db.ts';
import {
  appendLiveImmichAlbumAssets,
  checkImmichStatus,
  createLiveImmichAlbum,
} from './immichClient.ts';

interface EnrichedAsset {
  asset: AssetRecord;
  histogram: LabHistogram;
  avgLab: LabMean;
  palette: PaletteSwatch[];
  timestampMs: number;
}

const SCREEN_ASPECT_RATIOS = [
  16 / 9,
  9 / 16,
  19.5 / 9,
  9 / 19.5,
  20 / 9,
  9 / 20,
  21 / 9,
  9 / 21,
];

function isSuspectedScreenshot(asset: AssetRecord): boolean {
  const missingCameraExif = !asset.exifMake && !asset.exifModel;
  const nameLooksLikeShot = /screenshot|screen_shot|screen\s*capture/i.test(asset.fileName);
  if (nameLooksLikeShot && missingCameraExif) return true;
  if (!missingCameraExif || asset.width <= 0 || asset.height <= 0) return false;
  const ratio = asset.width / asset.height;
  return SCREEN_ASPECT_RATIOS.some((r) => Math.abs(ratio - r) < 0.035);
}

function isValidGps(lat: number | null, lng: number | null): lat is number {
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Reject Null Island (0, 0) placeholder GPS tags
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return false;
  return true;
}

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const CYRILLIC_COUNTRY_RE =
  /russia|belarus|ukraine|kazakhstan|kyrgyzstan|bulgaria|serbia|macedonia|mongolia|tajikistan|uzbekistan|montenegro|bosnia/i;

function sanitizePlaceName(
  rawCity: string | null | undefined,
  country: string | null | undefined
): string | null {
  const city = (rawCity || '').trim();
  if (!city) return null;
  const c = (country || '').trim();
  // Guard against stray Cyrillic/Russian GeoNames labels attached to non-Cyrillic countries
  if (CYRILLIC_RE.test(city) && c && !CYRILLIC_COUNTRY_RE.test(c)) {
    return null;
  }
  return city;
}

function pickBucketCity(
  cities: Map<string, number>,
  country: string | null,
  fallbackLat: number,
  fallbackLng: number,
  states?: Map<string, number>
): string {
  const allowCyrillic = country ? CYRILLIC_COUNTRY_RE.test(country) : false;
  const countryLower = (country || '').trim().toLowerCase();
  const stateKeysLower = new Set(
    Array.from(states?.keys() || []).map((s) => s.trim().toLowerCase())
  );

  const validCityEntries = Array.from(cities.entries())
    .filter(([name]) => {
      const n = name.trim();
      if (!n || n.toLowerCase() === 'away' || n.toLowerCase() === 'unknown') return false;
      // Never let country name outvote a specific city inside the city map
      if (countryLower && n.toLowerCase() === countryLower) return false;
      return allowCyrillic || !CYRILLIC_RE.test(n);
    })
    .sort((x, y) => y[1] - x[1]);

  // 1a. Prefer genuine specific cities (not matching a state/province fallback)
  const specificCity = validCityEntries.find(
    ([name]) => !stateKeysLower.has(name.trim().toLowerCase())
  );
  if (specificCity) {
    return specificCity[0];
  }

  // 1b. Any remaining valid city entry
  if (validCityEntries.length > 0) {
    return validCityEntries[0][0];
  }

  // 2. Fall back to state / province / region before country
  if (states && states.size > 0) {
    const stateEntries = Array.from(states.entries())
      .filter(([name]) => {
        const n = name.trim();
        if (!n) return false;
        if (countryLower && n.toLowerCase() === countryLower) return false;
        return allowCyrillic || !CYRILLIC_RE.test(n);
      })
      .sort((x, y) => y[1] - x[1]);
    if (stateEntries.length > 0) {
      return stateEntries[0][0];
    }
  }

  // 3. Fall back to country only when no city or state exists anywhere in the bucket
  if (country && (allowCyrillic || !CYRILLIC_RE.test(country))) {
    return country;
  }

  if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng) && (fallbackLat !== 0 || fallbackLng !== 0)) {
    return `${fallbackLat.toFixed(2)}, ${fallbackLng.toFixed(2)}`;
  }
  return 'Away';
}

function encodeGeohash5(lat: number, lng: number): string {
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90,
    maxLat = 90,
    minLng = -180,
    maxLng = 180;
  let isEven = true;
  let bit = 0;
  let ch = 0;
  let hash = '';

  while (hash.length < 5) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatYearMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '2026-11';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Nov 2026';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function jaccardSimilarity(a: Iterable<string>, b: Iterable<string>): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeGpsCentroid(items: EnrichedAsset[]): { lat: number; lng: number } | null {
  let latSum = 0;
  let lngSum = 0;
  let n = 0;
  for (const item of items) {
    if (isValidGps(item.asset.latitude, item.asset.longitude) && item.asset.longitude !== null) {
      latSum += item.asset.latitude;
      lngSum += item.asset.longitude;
      n++;
    }
  }
  if (n === 0) return null;
  return { lat: latSum / n, lng: lngSum / n };
}

function computeExifLightingShift(before: EnrichedAsset[], after: EnrichedAsset[]): number | null {
  const isoBefore = before
    .map((x) => x.asset.iso)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const isoAfter = after
    .map((x) => x.asset.iso)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  const camBefore = new Set(
    before.map((x) => x.asset.exifModel || x.asset.lensModel).filter(Boolean)
  );
  const camAfter = new Set(
    after.map((x) => x.asset.exifModel || x.asset.lensModel).filter(Boolean)
  );

  let isoShift: number | null = null;
  if (isoBefore.length > 0 && isoAfter.length > 0) {
    const meanLogBefore =
      isoBefore.reduce((s, v) => s + Math.log2(v), 0) / isoBefore.length;
    const meanLogAfter =
      isoAfter.reduce((s, v) => s + Math.log2(v), 0) / isoAfter.length;
    // 4 stops of ISO change (e.g. ISO 100 daylight -> ISO 1600 indoor/night) = 1.0 shift
    isoShift = Math.min(1, Math.abs(meanLogAfter - meanLogBefore) / 4);
  }

  let camShift: number | null = null;
  if (camBefore.size > 0 && camAfter.size > 0) {
    camShift = 1 - jaccardSimilarity(camBefore as Set<string>, camAfter as Set<string>);
  }

  if (isoShift !== null && camShift !== null) {
    return Number((isoShift * 0.7 + camShift * 0.3).toFixed(3));
  }
  if (isoShift !== null) return Number(isoShift.toFixed(3));
  if (camShift !== null) return Number((camShift * 0.5).toFixed(3));
  return null;
}

function buildClusterSignalBreakdown(items: EnrichedAsset[]): ClusterSignalBreakdown {
  const tagCounts = new Map<string, number>();
  const personNameCounts = new Map<string, number>();
  let gpsCount = 0;
  let mlCount = 0;
  let faceCount = 0;
  let exifCount = 0;
  let favoriteCount = 0;

  for (const item of items) {
    const a = item.asset;
    if (isValidGps(a.latitude, a.longitude)) gpsCount++;
    if (a.smartTags.length > 0) {
      mlCount++;
      for (const t of a.smartTags) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
    if (a.peopleIds.length > 0) faceCount++;
    for (const name of a.peopleNames || []) {
      if (name.trim()) {
        personNameCounts.set(name.trim(), (personNameCounts.get(name.trim()) || 0) + 1);
      }
    }
    if (a.exifModel || a.lensModel || a.iso !== null) exifCount++;
    if (a.isFavorite) favoriteCount++;
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
    .map(([t]) => t);
  const namedPeople = Array.from(personNameCounts.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
    .map(([p]) => p);

  return {
    gps: gpsCount > 0,
    immichMl: mlCount > 0,
    chroma: true,
    faces: faceCount > 0,
    exif: exifCount > 0,
    favoriteCount,
    topTags,
    namedPeople,
  };
}

function pickTopOccasion(assets: EnrichedAsset[]): string | null {
  const counts = new Map<string, number>();
  const priorityLabels: Record<string, string> = {
    'wedding ceremony': 'Wedding Ceremony',
    'birthday party': 'Birthday Celebration',
    'birthday cake': 'Birthday Celebration',
    celebration: 'Birthday Celebration',
    'beach ocean': 'Beach',
    beach: 'Beach',
    'sunset sunrise': 'Sunset',
    sunset: 'Sunset',
    'mountain hiking': 'Mountain Hike',
    hiking: 'Mountain Hike',
    mountains: 'Mountain Hike',
    'restaurant dinner': 'Dinner',
    dinner: 'Dinner',
    nightlife: 'Nightlife',
    'city architecture': 'Architecture Walk',
    architecture: 'Architecture Walk',
    promenade: 'Promenade Walk',
    'concert stage': 'Live Concert',
    concert: 'Live Concert',
    'snow skiing': 'Snow & Winter',
    'museum art gallery': 'Museum & Art',
    'family portrait': 'Family Gathering',
    'pet dog cat': 'Pets',
    'sports game': 'Sports',
    'fireworks festival': 'Festival',
    'coffee cafe': 'Cafe Outing',
    'temple monument': 'Heritage & Temples',
    'garden flowers': 'Garden & Nature',
    'road trip': 'Road Trip',
  };

  for (const item of assets) {
    for (const tag of item.asset.smartTags) {
      const key = tag.toLowerCase();
      if (priorityLabels[key]) {
        const label = priorityLabels[key];
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [label, c] of counts.entries()) {
    if (c > bestCount) {
      bestCount = c;
      best = label;
    }
  }
  return best;
}

function pickGuestCompanionTitle(
  assets: EnrichedAsset[],
  householdPeople: Set<string>
): string | null {
  const nameCounts = new Map<string, number>();
  for (const item of assets) {
    const names = item.asset.peopleNames || [];
    const ids = item.asset.peopleIds || [];
    for (let i = 0; i < names.length; i++) {
      const pid = ids[i];
      if (pid && householdPeople.has(pid)) continue;
      const n = names[i]?.trim();
      if (n) nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
    }
  }
  const topNames = Array.from(nameCounts.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([n]) => n);
  if (topNames.length === 0) return null;
  return `With ${topNames.join(' & ')}`;
}

function computeAvgLab(items: EnrichedAsset[]): LabMean {
  if (items.length === 0) return { l: 50, a: 0, b: 0, chroma: 0 };
  let sumL = 0,
    sumA = 0,
    sumB = 0;
  for (const x of items) {
    sumL += x.avgLab.l;
    sumA += x.avgLab.a;
    sumB += x.avgLab.b;
  }
  const l = sumL / items.length;
  const a = sumA / items.length;
  const b = sumB / items.length;
  return {
    l: Number(l.toFixed(1)),
    a: Number(a.toFixed(1)),
    b: Number(b.toFixed(1)),
    chroma: Number(Math.hypot(a, b).toFixed(1)),
  };
}

function deterministicHash(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

function formatAlbumTitle(
  settings: OrganizerSettings,
  opts: {
    startDate: string;
    eventName: string;
    isMaster: boolean;
    chapterSubtitle?: string;
    clusterType: 'trip' | 'local_event' | 'chapter';
    locationLabel: string;
  }
): string {
  const prefix = settings.titlePrefix.trim() ? `${settings.titlePrefix.trim()} ` : '';
  const ym = formatYearMonth(opts.startDate);

  if (settings.useStructuredPrefix) {
    if (opts.clusterType === 'chapter' && opts.chapterSubtitle) {
      return `${prefix}${ym} • ${opts.eventName} — ${opts.chapterSubtitle}`;
    }
    if (opts.isMaster) {
      return `${prefix}${ym} • ${opts.eventName} (All)`;
    }
    return `${prefix}${ym} • ${opts.eventName}`;
  }

  const monYr = formatMonthYear(opts.startDate);
  if (opts.clusterType === 'chapter' && opts.chapterSubtitle) {
    return `${prefix}${opts.eventName}: ${opts.chapterSubtitle} (${monYr})`;
  }
  return `${prefix}${opts.eventName} • ${opts.locationLabel} (${monYr})`;
}

/**
 * Runs the complete 4-Stage Clustering & Color-Tone Pipeline against SQLite assets.
 */
export function runFullPipeline(): {
  summary: PipelineRunSummary;
  clusters: ClusterRecord[];
} {
  const startedAt = Date.now();
  const db = getDb();
  const settings = getSettings();
  const allRows = getAllAssetsWithHist();

  // =========================================================================
  // STAGE 1: Pre-Filter & SQLite Feature Cache
  // =========================================================================
  let excludedArchivedOrTrashed = 0;
  let excludedAlreadyAlbumed = 0;
  let excludedScreenshots = 0;
  let excludedByPathRule = 0;
  let cacheHits = 0;
  let newlyExtracted = 0;

  const updateFilterStmt = db.prepare(
    'UPDATE assets SET is_screenshot = ?, excluded_reason = ? WHERE id = ?'
  );
  const updateLabStmt = db.prepare(`
    UPDATE assets
    SET lab_l = ?, lab_a = ?, lab_b = ?, lab_chroma = ?, lab_hist_json = ?, palette_json = ?
    WHERE id = ?
  `);

  const eligible: EnrichedAsset[] = [];

  for (const row of allRows) {
    const a = row.asset;
    let reason: string | null = null;
    let shot = false;

    if (a.isArchived || a.isTrashed) {
      excludedArchivedOrTrashed++;
      reason = a.isTrashed ? 'Trashed asset' : 'Archived asset';
    } else if (a.isAlreadyAlbumed) {
      excludedAlreadyAlbumed++;
      reason = 'Already in manual album';
    } else if (
      settings.excludedPaths.some((rule) =>
        a.originalPath.toLowerCase().includes(rule.toLowerCase())
      )
    ) {
      excludedByPathRule++;
      const matched = settings.excludedPaths.find((rule) =>
        a.originalPath.toLowerCase().includes(rule.toLowerCase())
      );
      reason = `Excluded path rule (${matched})`;
    } else if (settings.ignoreScreenshots && isSuspectedScreenshot(a)) {
      excludedScreenshots++;
      shot = true;
      reason = 'Suspected screenshot (no camera EXIF + screen aspect ratio)';
    }

    updateFilterStmt.run(shot ? 1 : 0, reason, a.id);
    if (reason) continue;

    // Feature Cache check: reuse cached CIELAB histogram & 5-color palette if present
    let histogram = row.histogram;
    let avgLab = a.avgLab;
    let palette = a.palette;

    if (histogram && avgLab && palette.length > 0) {
      cacheHits++;
    } else {
      // Extract real CIELAB features from stored raster thumbnail
      if (row.thumbnailFile) {
        const resolved = path.resolve(THUMBNAIL_DIR, path.basename(row.thumbnailFile));
        if (resolved.startsWith(THUMBNAIL_DIR + path.sep) && fs.existsSync(resolved)) {
          try {
            const buf = fs.readFileSync(resolved);
            const decoded = decodeImageBufferToRgba(buf);
            const extracted = extractColorFeaturesFromPixels(
              decoded.data,
              decoded.width,
              decoded.height
            );
            histogram = extracted.histogram;
            avgLab = extracted.avgLab;
            palette = extracted.palette;
            updateLabStmt.run(
              avgLab.l,
              avgLab.a,
              avgLab.b,
              avgLab.chroma,
              JSON.stringify(histogram),
              JSON.stringify(palette),
              a.id
            );
            newlyExtracted++;
          } catch {
            // Unsupported or corrupt thumbnail buffer falls back cleanly below
          }
        }
      }
    }

    if (!histogram || !avgLab) {
      // Fallback neutral distribution if thumbnail absent
      histogram = {
        l: new Array(12).fill(1 / 12),
        a: new Array(12).fill(1 / 12),
        b: new Array(12).fill(1 / 12),
      };
      avgLab = { l: 50, a: 0, b: 0, chroma: 0 };
      palette = [];
    }

    eligible.push({
      asset: { ...a, avgLab, palette, cachedFeature: true },
      histogram,
      avgLab,
      palette,
      timestampMs: new Date(a.localDateTime).getTime(),
    });
  }

  eligible.sort((x, y) => x.timestampMs - y.timestampMs);

  const stage1: Stage1Stats = {
    totalAssets: allRows.length,
    excludedArchivedOrTrashed,
    excludedAlreadyAlbumed,
    excludedScreenshots,
    excludedByPathRule,
    eligibleAssets: eligible.length,
    cacheHits,
    newlyExtracted,
  };

  // =========================================================================
  // STAGE 2: Spatiotemporal Grouping
  //   1. Home-Base Inference (distinct calendar days per 5km geohash, or Manual/Disabled override)
  //   2. Trips (outside homeRadiusKm, merged across gaps < tripGapHours)
  //   3. Local Events (density clustering on time + fine GPS + non-household faces)
  // =========================================================================
  const geohashBuckets = new Map<
    string,
    {
      count: number;
      days: Set<string>;
      latSum: number;
      lngSum: number;
      cities: Map<string, number>;
      states: Map<string, number>;
      countries: Map<string, number>;
    }
  >();

  // Build candidate geohash buckets from eligible assets (fall back to all non-trashed if eligible has no GPS)
  const gpsSourceAssets = eligible.some((e) => isValidGps(e.asset.latitude, e.asset.longitude))
    ? eligible.map((e) => e.asset)
    : allRows
        .map((r) => r.asset)
        .filter((a) => !a.isArchived && !a.isTrashed && isValidGps(a.latitude, a.longitude));

  for (const a of gpsSourceAssets) {
    const { latitude, longitude, city, state, country } = a;
    if (!isValidGps(latitude, longitude) || longitude === null) continue;
    const gh = encodeGeohash5(latitude, longitude);
    const bucket = geohashBuckets.get(gh) || {
      count: 0,
      days: new Set<string>(),
      latSum: 0,
      lngSum: 0,
      cities: new Map(),
      states: new Map(),
      countries: new Map(),
    };
    bucket.count++;
    bucket.days.add((a.localDateTime || '').slice(0, 10));
    bucket.latSum += latitude;
    bucket.lngSum += longitude;
    const cTrim = country && country.trim() ? country.trim() : null;
    const cleanCity = sanitizePlaceName(city, cTrim);
    if (cleanCity && (!cTrim || cleanCity.toLowerCase() !== cTrim.toLowerCase())) {
      bucket.cities.set(cleanCity, (bucket.cities.get(cleanCity) || 0) + 1);
    }
    const cleanState = sanitizePlaceName(state, cTrim);
    if (cleanState && (!cTrim || cleanState.toLowerCase() !== cTrim.toLowerCase())) {
      bucket.states.set(cleanState, (bucket.states.get(cleanState) || 0) + 1);
    }
    if (cTrim) {
      bucket.countries.set(cTrim, (bucket.countries.get(cTrim) || 0) + 1);
    }
    geohashBuckets.set(gh, bucket);
  }

  // Rank candidates by distinct calendar days first (true residency signal), then photo count
  const candidateHomeBases: CandidateHomeBase[] = Array.from(geohashBuckets.entries())
    .map(([gh, b]) => {
      const avgLat = b.latSum / b.count;
      const avgLng = b.lngSum / b.count;
      const topCountry =
        Array.from(b.countries.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
      const topCity = pickBucketCity(b.cities, topCountry, avgLat, avgLng, b.states);
      return {
        city: topCity,
        country: topCountry,
        geohash: gh,
        lat: Number(avgLat.toFixed(4)),
        lng: Number(avgLng.toFixed(4)),
        assetCount: b.count,
        distinctDays: b.days.size,
      };
    })
    .sort((x, y) => y.distinctDays - x.distinctDays || y.assetCount - x.assetCount)
    .slice(0, 20);

  let homeGeohash = '—';
  let homeLat = 0;
  let homeLng = 0;
  let homeCity = '—';
  let homeCountry: string | null = null;
  let homeCount = 0;
  let homeDistinctDays = 0;
  let hasActiveHomeBase = false;
  let effectiveHomeMode = settings.homeBaseMode;

  if (
    settings.homeBaseMode === 'manual' &&
    isValidGps(settings.homeBaseLatOverride, settings.homeBaseLngOverride) &&
    settings.homeBaseLngOverride !== null
  ) {
    homeLat = settings.homeBaseLatOverride;
    homeLng = settings.homeBaseLngOverride;
    homeGeohash = encodeGeohash5(homeLat, homeLng);
    homeCity =
      settings.homeBaseCityOverride.trim() ||
      `Custom (${homeLat.toFixed(2)}, ${homeLng.toFixed(2)})`;
    hasActiveHomeBase = true;
    const homeDaySet = new Set<string>();
    const nearCountries = new Map<string, number>();
    for (const item of eligible) {
      const { latitude, longitude, country } = item.asset;
      if (isValidGps(latitude, longitude) && longitude !== null) {
        if (haversineKm(homeLat, homeLng, latitude, longitude) <= settings.homeRadiusKm) {
          homeCount++;
          homeDaySet.add(item.asset.localDateTime.slice(0, 10));
          if (country) nearCountries.set(country, (nearCountries.get(country) || 0) + 1);
        }
      }
    }
    homeDistinctDays = homeDaySet.size;
    homeCountry =
      Array.from(nearCountries.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  } else if (settings.homeBaseMode === 'disabled') {
    homeCity = 'Disabled';
    homeGeohash = '—';
    hasActiveHomeBase = false;
  } else {
    effectiveHomeMode = 'auto';
    const topCandidate = candidateHomeBases[0];
    if (topCandidate) {
      homeCity = topCandidate.city;
      homeCountry = topCandidate.country;
      homeGeohash = topCandidate.geohash;
      homeLat = topCandidate.lat;
      homeLng = topCandidate.lng;
      homeCount = topCandidate.assetCount;
      homeDistinctDays = topCandidate.distinctDays;
      hasActiveHomeBase = true;
    }
  }

  // Partition assets into Away (Trips), Home-Radius, and No-GPS (candidates for Trip bridging or Local Events)
  const awayAssets: EnrichedAsset[] = [];
  const homeGeoAssets: EnrichedAsset[] = [];
  const noGpsAssets: EnrichedAsset[] = [];

  for (const item of eligible) {
    const { latitude, longitude } = item.asset;
    if (isValidGps(latitude, longitude) && longitude !== null) {
      if (effectiveHomeMode === 'disabled') {
        awayAssets.push(item);
      } else if (hasActiveHomeBase) {
        const distKm = haversineKm(homeLat, homeLng, latitude, longitude);
        if (distKm > settings.homeRadiusKm) {
          awayAssets.push(item);
        } else {
          homeGeoAssets.push(item);
        }
      } else {
        homeGeoAssets.push(item);
      }
    } else {
      noGpsAssets.push(item);
    }
  }

  interface RawEvent {
    id: string;
    type: 'trip' | 'local_event';
    assets: EnrichedAsset[];
    locationLabel: string;
    eventName: string;
  }

  const rawEvents: RawEvent[] = [];
  let unclusteredNoiseCount = 0;
  let bridgedNoGpsCount = 0;

  // 2A. Multi-Signal Macro Trip Clustering (GPS + Time + State/Country + Immich ML + People + CIELAB Chroma)
  const tripGapMs = settings.tripGapHours * 3600 * 1000;
  const rawTripBuckets: EnrichedAsset[][] = [];
  let currentTrip: EnrichedAsset[] = [];

  const canContinueTrip = (prev: EnrichedAsset, next: EnrichedAsset): boolean => {
    const gap = next.timestampMs - prev.timestampMs;
    if (gap > tripGapMs) return false;

    const distKm =
      isValidGps(prev.asset.latitude, prev.asset.longitude) &&
      isValidGps(next.asset.latitude, next.asset.longitude)
        ? haversineKm(
            prev.asset.latitude,
            prev.asset.longitude!,
            next.asset.latitude,
            next.asset.longitude!
          )
        : null;

    // Hard spatial separation for long-haul jumps (> 320 km)
    if (distKm !== null && distKm > 320) return false;
    // Direct regional continuity (< 120 km)
    if (distKm !== null && distKm <= 120) return true;
    // Same city continuity
    if (prev.asset.city && next.asset.city && prev.asset.city === next.asset.city) return true;

    // Road-trip / multi-stop bridge (120–260 km) reinforced by same State + ML tags + Faces + Chroma
    const sameState =
      Boolean(prev.asset.state && next.asset.state && prev.asset.state === next.asset.state);
    const sameCountry =
      Boolean(prev.asset.country && next.asset.country && prev.asset.country === next.asset.country);
    if (sameState || (sameCountry && distKm !== null && distKm <= 200)) {
      const mlOverlap = jaccardSimilarity(prev.asset.smartTags, next.asset.smartTags);
      const peopleOverlap = jaccardSimilarity(prev.asset.peopleIds, next.asset.peopleIds);
      const chromaSim = 1 - computeLabHistogramEmd(prev.histogram, next.histogram);
      if (peopleOverlap > 0 || mlOverlap >= 0.35 || (sameState && chromaSim >= 0.72)) {
        return true;
      }
    }

    return false;
  };

  for (const item of awayAssets) {
    if (currentTrip.length === 0) {
      currentTrip.push(item);
      continue;
    }
    const prev = currentTrip[currentTrip.length - 1];
    if (canContinueTrip(prev, item)) {
      currentTrip.push(item);
    } else {
      rawTripBuckets.push(currentTrip);
      currentTrip = [item];
    }
  }
  if (currentTrip.length > 0) {
    rawTripBuckets.push(currentTrip);
  }

  // 2A+. DSLR / No-GPS Photo Bridging:
  // Bridge non-geotagged photos shot during a Trip window (within 4h) when Chroma/ML/Faces/Camera align
  const remainingNoGps: EnrichedAsset[] = [];
  const bridgeWindowMs = 4 * 3600 * 1000;

  for (const item of noGpsAssets) {
    let matchedTrip: EnrichedAsset[] | null = null;
    let bestScore = 0;

    for (const trip of rawTripBuckets) {
      if (trip.length === 0) continue;
      const tStart = trip[0].timestampMs - bridgeWindowMs;
      const tEnd = trip[trip.length - 1].timestampMs + bridgeWindowMs;
      if (item.timestampMs < tStart || item.timestampMs > tEnd) continue;

      // Find chronologically nearest photo in this trip
      let nearest = trip[0];
      let minDt = Math.abs(item.timestampMs - nearest.timestampMs);
      for (const candidate of trip) {
        const dt = Math.abs(item.timestampMs - candidate.timestampMs);
        if (dt < minDt) {
          minDt = dt;
          nearest = candidate;
        }
      }
      if (minDt > bridgeWindowMs) continue;

      const timeAffinity = Math.max(0, 1 - minDt / bridgeWindowMs);
      const chromaAffinity = 1 - computeLabHistogramEmd(item.histogram, nearest.histogram);
      const mlAffinity = jaccardSimilarity(item.asset.smartTags, nearest.asset.smartTags);
      const peopleAffinity = jaccardSimilarity(item.asset.peopleIds, nearest.asset.peopleIds);
      const score =
        timeAffinity * 0.45 +
        chromaAffinity * 0.30 +
        mlAffinity * 0.15 +
        peopleAffinity * 0.10;

      if (score >= 0.48 && score > bestScore) {
        bestScore = score;
        matchedTrip = trip;
      }
    }

    if (matchedTrip) {
      matchedTrip.push(item);
      bridgedNoGpsCount++;
    } else {
      remainingNoGps.push(item);
    }
  }

  // Finalize Macro Trips (strict place specificity: City -> State -> Country -> GPS)
  for (const bucket of rawTripBuckets) {
    bucket.sort((x, y) => x.timestampMs - y.timestampMs);
    if (bucket.length >= settings.minPhotosPerAlbum) {
      const cityCounts = new Map<string, number>();
      const stateCounts = new Map<string, number>();
      const countryCounts = new Map<string, number>();
      for (const a of bucket) {
        const rawCountry = a.asset.country && a.asset.country.trim() ? a.asset.country.trim() : null;
        const cleanCity = sanitizePlaceName(a.asset.city, rawCountry);
        const cleanState = sanitizePlaceName(a.asset.state, rawCountry);

        // Only count real city names in cityCounts — never let country or 'Away' outvote a specific city
        if (cleanCity && (!rawCountry || cleanCity.toLowerCase() !== rawCountry.toLowerCase())) {
          cityCounts.set(cleanCity, (cityCounts.get(cleanCity) || 0) + 1);
        }
        if (cleanState && (!rawCountry || cleanState.toLowerCase() !== rawCountry.toLowerCase())) {
          stateCounts.set(cleanState, (stateCounts.get(cleanState) || 0) + 1);
        }
        if (rawCountry) {
          countryCounts.set(rawCountry, (countryCounts.get(rawCountry) || 0) + 1);
        }
      }
      const country =
        Array.from(countryCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
      const centroid = computeGpsCentroid(bucket);
      const topCity = pickBucketCity(
        cityCounts,
        country,
        centroid?.lat || 0,
        centroid?.lng || 0,
        stateCounts
      );
      const locationLabel = country && country !== topCity ? `${topCity}, ${country}` : topCity;
      rawEvents.push({
        id: `evt-trip-${topCity.toLowerCase().replace(/[^a-z0-9]/g, '')}-${formatYearMonth(bucket[0].asset.localDateTime)}-${rawEvents.length + 1}`,
        type: 'trip',
        assets: bucket,
        locationLabel,
        eventName: effectiveHomeMode === 'disabled' ? `${topCity}` : `${topCity} Trip`,
      });
    } else {
      unclusteredNoiseCount += bucket.length;
    }
  }

  // Combine remaining local + unbridged no-GPS photos chronologically for Local Event Discovery
  const homeAssets: EnrichedAsset[] = [...homeGeoAssets, ...remainingNoGps].sort(
    (x, y) => x.timestampMs - y.timestampMs
  );

  // Identify household faces: people appearing across >40% of distinct home days
  const homeDays = new Set(homeAssets.map((a) => a.asset.localDateTime.slice(0, 10)));
  const personDayMap = new Map<string, Set<string>>();
  for (const a of homeAssets) {
    const day = a.asset.localDateTime.slice(0, 10);
    for (const pid of a.asset.peopleIds) {
      if (!personDayMap.has(pid)) personDayMap.set(pid, new Set());
      personDayMap.get(pid)!.add(day);
    }
  }
  const householdPeople = new Set<string>();
  const dayThreshold = Math.max(2, Math.ceil(homeDays.size * 0.4));
  for (const [pid, days] of personDayMap.entries()) {
    if (days.size >= dayThreshold) {
      householdPeople.add(pid);
    }
  }

  // 2B. Multi-Signal Local Event Discovery (Chronological Window + GPS + Immich ML + CIELAB Chroma + Faces + EXIF)
  const localGapMs = settings.localEventGapHours * 3600 * 1000;
  const fineRadiusKm = settings.localEventRadiusMeters / 1000;
  const visited = new Set<number>();
  const minClusterPts = Math.max(3, settings.minPhotosPerAlbum);

  const areLocalNeighbors = (a: EnrichedAsset, b: EnrichedAsset): boolean => {
    const dt = Math.abs(a.timestampMs - b.timestampMs);
    if (dt > localGapMs) return false;

    const aGuests = a.asset.peopleIds.filter((p) => !householdPeople.has(p));
    const bGuests = b.asset.peopleIds.filter((p) => !householdPeople.has(p));
    const sharesGuest = aGuests.some((g) => bGuests.includes(g));
    if (sharesGuest) return true;

    const bothHaveGps =
      isValidGps(a.asset.latitude, a.asset.longitude) &&
      isValidGps(b.asset.latitude, b.asset.longitude);

    let distKm: number | null = null;
    if (bothHaveGps) {
      distKm = haversineKm(
        a.asset.latitude!,
        a.asset.longitude!,
        b.asset.latitude!,
        b.asset.longitude!
      );
      // Fast-path: same exact venue burst within 2 hours
      if (distKm <= fineRadiusKm * 1.6 && dt <= Math.min(localGapMs, 2 * 3600 * 1000)) {
        return true;
      }
      // Hard reject if clearly different local venues (> 3.5x radius and > 1.5 km apart)
      if (distKm > Math.max(1.5, fineRadiusKm * 4)) {
        return false;
      }
    }

    // Weighted multi-signal affinity fusion (re-normalized across active signals)
    let weightedSum = 0;
    let totalWeight = 0;

    // 1. Temporal proximity (always active)
    const timeScore = Math.max(0, 1 - dt / localGapMs);
    weightedSum += timeScore * 0.24;
    totalWeight += 0.24;

    // 2. GPS proximity (when both have valid coordinates)
    if (distKm !== null) {
      const gpsScore = Math.max(0, 1 - distKm / Math.max(0.25, fineRadiusKm * 2.8));
      weightedSum += gpsScore * 0.34;
      totalWeight += 0.34;
    }

    // 3. Immich ML CLIP semantic similarity (when either asset has CLIP tags)
    if (a.asset.smartTags.length > 0 || b.asset.smartTags.length > 0) {
      const mlScore = jaccardSimilarity(a.asset.smartTags, b.asset.smartTags);
      weightedSum += mlScore * 0.18;
      totalWeight += 0.18;
    }

    // 4. CIELAB Chroma continuity (always active)
    const chromaScore = Math.max(0, 1 - computeLabHistogramEmd(a.histogram, b.histogram));
    weightedSum += chromaScore * 0.16;
    totalWeight += 0.16;

    // 5. People / Camera / EXIF lighting regime continuity
    let contextScore = 0;
    let hasContext = false;
    if (a.asset.peopleIds.length > 0 && b.asset.peopleIds.length > 0) {
      contextScore = Math.max(
        contextScore,
        jaccardSimilarity(a.asset.peopleIds, b.asset.peopleIds)
      );
      hasContext = true;
    }
    if (a.asset.iso && b.asset.iso) {
      const isoDiff = Math.abs(Math.log2(a.asset.iso) - Math.log2(b.asset.iso));
      const lightingSim = Math.max(0, 1 - isoDiff / 4);
      contextScore = hasContext ? contextScore * 0.6 + lightingSim * 0.4 : lightingSim;
      hasContext = true;
    }
    if (a.asset.exifModel && b.asset.exifModel && a.asset.exifModel === b.asset.exifModel) {
      contextScore = hasContext ? Math.min(1, contextScore + 0.15) : 0.7;
      hasContext = true;
    }
    if (hasContext) {
      weightedSum += contextScore * 0.08;
      totalWeight += 0.08;
    }

    const affinity = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return affinity >= 0.56;
  };

  // Chronological-window BFS (O(N * K) instead of O(N^2) so 10,000+ photos cluster in milliseconds)
  let localIdx = 1;
  for (let i = 0; i < homeAssets.length; i++) {
    if (visited.has(i)) continue;
    const queue = [i];
    const component: number[] = [];
    visited.add(i);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      const currTs = homeAssets[curr].timestampMs;

      // Scan backward within localGapMs
      for (let j = curr - 1; j >= 0; j--) {
        if (currTs - homeAssets[j].timestampMs > localGapMs) break;
        if (!visited.has(j) && areLocalNeighbors(homeAssets[curr], homeAssets[j])) {
          visited.add(j);
          queue.push(j);
        }
      }
      // Scan forward within localGapMs
      for (let j = curr + 1; j < homeAssets.length; j++) {
        if (homeAssets[j].timestampMs - currTs > localGapMs) break;
        if (!visited.has(j) && areLocalNeighbors(homeAssets[curr], homeAssets[j])) {
          visited.add(j);
          queue.push(j);
        }
      }
    }

    if (component.length >= minClusterPts) {
      const members = component
        .map((idx) => homeAssets[idx])
        .sort((x, y) => x.timestampMs - y.timestampMs);
      const occasion =
        pickTopOccasion(members) ||
        pickGuestCompanionTitle(members, householdPeople) ||
        `Local Gathering #${localIdx}`;
      const localCityCounts = new Map<string, number>();
      const localStateCounts = new Map<string, number>();
      let localCountry: string | null = null;
      for (const m of members) {
        const cTrim = m.asset.country && m.asset.country.trim() ? m.asset.country.trim() : null;
        if (cTrim && !localCountry) localCountry = cTrim;
        const cleanC = sanitizePlaceName(m.asset.city, cTrim);
        if (cleanC && (!cTrim || cleanC.toLowerCase() !== cTrim.toLowerCase())) {
          localCityCounts.set(cleanC, (localCityCounts.get(cleanC) || 0) + 1);
        }
        const cleanS = sanitizePlaceName(m.asset.state, cTrim);
        if (cleanS && (!cTrim || cleanS.toLowerCase() !== cTrim.toLowerCase())) {
          localStateCounts.set(cleanS, (localStateCounts.get(cleanS) || 0) + 1);
        }
      }
      const pickedLocalCity =
        localCityCounts.size > 0 || localStateCounts.size > 0
          ? pickBucketCity(localCityCounts, localCountry, 0, 0, localStateCounts)
          : null;
      const city =
        (pickedLocalCity && pickedLocalCity !== 'Away' ? pickedLocalCity : null) ||
        (hasActiveHomeBase ? homeCity : 'Local');
      const country = localCountry;
      const locationLabel = country && country !== city ? `${city}, ${country}` : city;

      rawEvents.push({
        id: `evt-local-${localIdx}-${formatYearMonth(members[0].asset.localDateTime)}`,
        type: 'local_event',
        assets: members,
        locationLabel,
        eventName: occasion,
      });
      localIdx++;
    } else {
      unclusteredNoiseCount += component.length;
    }
  }

  const stage2: Stage2Stats = {
    homeBaseCity: homeCity,
    homeBaseCountry: homeCountry,
    homeBaseGeohash: homeGeohash,
    homeBaseLat: Number(homeLat.toFixed(4)),
    homeBaseLng: Number(homeLng.toFixed(4)),
    homeBaseAssetCount: homeCount,
    homeBaseDistinctDays: homeDistinctDays,
    homeBaseSource: effectiveHomeMode,
    candidateHomeBases,
    householdPeopleIds: Array.from(householdPeople),
    macroTripCount: rawEvents.filter((e) => e.type === 'trip').length,
    localEventCount: rawEvents.filter((e) => e.type === 'local_event').length,
    bridgedNoGpsCount,
    gpsTaggedCount: eligible.filter((e) => isValidGps(e.asset.latitude, e.asset.longitude)).length,
    mlTaggedCount: eligible.filter((e) => e.asset.smartTags.length > 0).length,
    faceTaggedCount: eligible.filter((e) => e.asset.peopleIds.length > 0).length,
    unclusteredNoiseCount,
  };

  // =========================================================================
  // STAGE 3 & 4: Sliding-Window CIELAB EMD Scene Split + Semantic Naming
  // =========================================================================
  const existingByHash = new Map<
    string,
    {
      title: string;
      status: ClusterRecord['status'];
      immich_album_id: string | null;
      synced_asset_count: number;
    }
  >();

  const existingClusterRows = db
    .prepare('SELECT cluster_hash, title, status, immich_album_id, synced_asset_count FROM clusters')
    .all() as Array<{
    cluster_hash: string;
    title: string;
    status: ClusterRecord['status'];
    immich_album_id: string | null;
    synced_asset_count: number;
  }>;
  for (const r of existingClusterRows) {
    existingByHash.set(r.cluster_hash, r);
  }

  const syncMapRows = db
    .prepare('SELECT cluster_hash, immich_album_id, synced_asset_ids_json FROM sync_mappings')
    .all() as Array<{
    cluster_hash: string;
    immich_album_id: string;
    synced_asset_ids_json: string;
  }>;
  const syncMapByHash = new Map<string, { albumId: string; count: number }>();
  for (const r of syncMapRows) {
    const ids = JSON.parse(r.synced_asset_ids_json || '[]') as string[];
    syncMapByHash.set(r.cluster_hash, { albumId: r.immich_album_id, count: ids.length });
  }

  let sceneSplitsDetected = 0;
  let totalChaptersCreated = 0;
  const moodDistribution: Record<string, number> = {};
  const signalUsage = { chroma: 0, immichMl: 0, gps: 0, faces: 0, exif: 0 };
  const eventTimelines: PipelineRunSummary['eventTimelines'] = [];

  const nextClusters: Array<{
    id: string;
    clusterHash: string;
    parentEventId: string | null;
    parentEventName: string | null;
    clusterType: 'trip' | 'local_event' | 'chapter';
    title: string;
    proposedTitle: string;
    locationLabel: string;
    moodLabel: AestheticMood;
    occasionLabel: string | null;
    startDate: string;
    endDate: string;
    palette: PaletteSwatch[];
    avgLab: LabMean;
    emdBoundaryScore: number;
    signalBreakdown: ClusterSignalBreakdown;
    status: ClusterRecord['status'];
    immichAlbumId: string | null;
    syncedAssetCount: number;
    assetIds: string[];
    emdSeries: EmdTimelinePoint[];
  }> = [];

  const windowSize = 5;

  for (const evt of rawEvents) {
    const photos = evt.assets;
    const points: EmdTimelinePoint[] = [];
    const splitIndices: number[] = [];
    const gpsScaleKm = evt.type === 'trip' ? 1.5 : 0.45;

    for (let i = 0; i < photos.length; i++) {
      let emdScore = 0;
      let compositeScore = 0;
      let gpsShift = 0;
      let semanticShift = 0;
      let peopleShift = 0;
      let exifShift = 0;
      let gapMinutes = 0;
      const activeSplitSignals: string[] = [];

      if (i > 0) {
        gapMinutes = Number(
          ((photos[i].timestampMs - photos[i - 1].timestampMs) / 60000).toFixed(1)
        );
        const beforeStart = Math.max(0, i - windowSize);
        const afterEnd = Math.min(photos.length, i + windowSize);
        const beforeSlice = photos.slice(beforeStart, i);
        const afterSlice = photos.slice(i, afterEnd);

        // 1. CIELAB Chroma EMD (always active, weight 0.45)
        const hBefore = averageHistograms(beforeSlice.map((p) => p.histogram));
        const hAfter = averageHistograms(afterSlice.map((p) => p.histogram));
        emdScore = computeLabHistogramEmd(hBefore, hAfter);

        let weightedScore = emdScore * 0.45;
        let totalWeight = 0.45;
        if (emdScore >= settings.emdThreshold * 0.85) activeSplitSignals.push('Chroma');

        // 2. Immich ML CLIP Semantic Shift (when tags exist in either window, weight 0.22)
        const tagsBefore = new Set(beforeSlice.flatMap((p) => p.asset.smartTags));
        const tagsAfter = new Set(afterSlice.flatMap((p) => p.asset.smartTags));
        if (tagsBefore.size > 0 || tagsAfter.size > 0) {
          semanticShift = Number((1 - jaccardSimilarity(tagsBefore, tagsAfter)).toFixed(3));
          weightedScore += semanticShift * 0.22;
          totalWeight += 0.22;
          if (semanticShift >= 0.65) activeSplitSignals.push('Immich ML');
        }

        // 3. GPS Micro-Venue Shift (when both windows have valid GPS centroids, weight 0.18)
        const cBefore = computeGpsCentroid(beforeSlice);
        const cAfter = computeGpsCentroid(afterSlice);
        if (cBefore && cAfter) {
          const distKm = haversineKm(cBefore.lat, cBefore.lng, cAfter.lat, cAfter.lng);
          gpsShift = Number(Math.min(1, distKm / gpsScaleKm).toFixed(3));
          weightedScore += gpsShift * 0.18;
          totalWeight += 0.18;
          if (gpsShift >= 0.5) activeSplitSignals.push('GPS');
        }

        // 4. Immich Facial Recognition Cohort Shift (when faces appear on both sides, weight 0.08)
        const peopleBefore = new Set(beforeSlice.flatMap((p) => p.asset.peopleIds));
        const peopleAfter = new Set(afterSlice.flatMap((p) => p.asset.peopleIds));
        if (peopleBefore.size > 0 && peopleAfter.size > 0) {
          peopleShift = Number((1 - jaccardSimilarity(peopleBefore, peopleAfter)).toFixed(3));
          weightedScore += peopleShift * 0.08;
          totalWeight += 0.08;
          if (peopleShift >= 0.6) activeSplitSignals.push('Faces');
        }

        // 5. EXIF Lighting / Camera Regime Shift (ISO + camera/lens, weight 0.07)
        const rawExifShift = computeExifLightingShift(beforeSlice, afterSlice);
        if (rawExifShift !== null) {
          exifShift = rawExifShift;
          weightedScore += exifShift * 0.07;
          totalWeight += 0.07;
          if (exifShift >= 0.5) activeSplitSignals.push('EXIF');
        }

        compositeScore = Number((weightedScore / totalWeight).toFixed(3));
      }

      const lastSplit = splitIndices.length > 0 ? splitIndices[splitIndices.length - 1] : 0;
      const enoughBefore = i - lastSplit >= 4;
      const enoughAfter = photos.length - i >= 4;
      const isSplitBoundary =
        settings.createMoodSubalbums &&
        i > 0 &&
        enoughBefore &&
        enoughAfter &&
        compositeScore >= settings.emdThreshold &&
        gapMinutes >= settings.sceneSplitGapMins;

      if (isSplitBoundary) {
        splitIndices.push(i);
        sceneSplitsDetected++;
        if (activeSplitSignals.includes('Chroma') || activeSplitSignals.length === 0) signalUsage.chroma++;
        if (activeSplitSignals.includes('Immich ML')) signalUsage.immichMl++;
        if (activeSplitSignals.includes('GPS')) signalUsage.gps++;
        if (activeSplitSignals.includes('Faces')) signalUsage.faces++;
        if (activeSplitSignals.includes('EXIF')) signalUsage.exif++;
      }

      points.push({
        index: i,
        assetId: photos[i].asset.id,
        fileName: photos[i].asset.fileName,
        timestamp: photos[i].asset.localDateTime,
        emdScore,
        compositeScore,
        gpsShift,
        semanticShift,
        peopleShift,
        exifShift,
        splitSignals: isSplitBoundary
          ? activeSplitSignals.length > 0
            ? activeSplitSignals
            : ['Chroma']
          : [],
        gapMinutes,
        labL: photos[i].avgLab.l,
        labB: photos[i].avgLab.b,
        isSplitBoundary,
        chapterIndex: splitIndices.length,
      });
    }

    // Build chapter slices
    const slices: Array<{ items: EnrichedAsset[]; boundaryEmd: number }> = [];
    let cursor = 0;
    for (const splitIdx of splitIndices) {
      slices.push({
        items: photos.slice(cursor, splitIdx),
        boundaryEmd:
          cursor === 0
            ? 0
            : points[cursor]?.compositeScore ?? points[cursor]?.emdScore ?? 0,
      });
      cursor = splitIdx;
    }
    slices.push({
      items: photos.slice(cursor),
      boundaryEmd:
        cursor === 0
          ? 0
          : points[cursor]?.compositeScore ?? points[cursor]?.emdScore ?? 0,
    });

    const hasSubChapters = slices.length > 1;
    const masterAvgLab = computeAvgLab(photos);
    const masterPalette = mergePalettesToFive(photos.map((p) => p.palette));
    const masterMood = classifyAestheticMood(masterAvgLab, masterPalette);
    const masterOccasion = pickTopOccasion(photos);
    const masterSignals = buildClusterSignalBreakdown(photos);

    eventTimelines.push({
      eventId: evt.id,
      eventName: evt.eventName,
      locationLabel: evt.locationLabel,
      clusterType: evt.type,
      photoCount: photos.length,
      chapterCount: slices.length,
      points,
    });

    // Master Event Album (for single-chapter events, or when createMasterAlbum is enabled)
    if (!hasSubChapters || settings.createMasterAlbum) {
      const hash = deterministicHash([
        evt.type,
        evt.eventName.toLowerCase(),
        formatYearMonth(photos[0].asset.localDateTime),
        'master',
      ]);
      const proposedTitle = formatAlbumTitle(settings, {
        startDate: photos[0].asset.localDateTime,
        eventName: evt.eventName,
        isMaster: hasSubChapters,
        clusterType: evt.type,
        locationLabel: evt.locationLabel,
      });

      const prev = existingByHash.get(hash);
      const syncInfo = syncMapByHash.get(hash);
      const hasNewUnsynced = syncInfo ? photos.length > syncInfo.count : false;

      moodDistribution[masterMood] = (moodDistribution[masterMood] || 0) + 1;

      nextClusters.push({
        id: `${evt.id}-master`,
        clusterHash: hash,
        parentEventId: evt.id,
        parentEventName: evt.eventName,
        clusterType: evt.type,
        title: prev?.title || proposedTitle,
        proposedTitle,
        locationLabel: evt.locationLabel,
        moodLabel: masterMood,
        occasionLabel: masterOccasion,
        startDate: photos[0].asset.localDateTime,
        endDate: photos[photos.length - 1].asset.localDateTime,
        palette: masterPalette,
        avgLab: masterAvgLab,
        emdBoundaryScore: Math.max(...points.map((p) => p.compositeScore ?? p.emdScore), 0),
        signalBreakdown: masterSignals,
        status:
          prev?.status === 'discarded'
            ? 'discarded'
            : syncInfo && !hasNewUnsynced
              ? 'synced'
              : prev?.status === 'approved'
                ? 'approved'
                : 'pending',
        immichAlbumId: syncInfo?.albumId || prev?.immich_album_id || null,
        syncedAssetCount: syncInfo?.count || prev?.synced_asset_count || 0,
        assetIds: photos.map((p) => p.asset.id),
        emdSeries: points,
      });
    }

    // Multi-Signal Theme & Color-Tone Sub-Chapter Albums
    if (hasSubChapters) {
      slices.forEach((slice, idx) => {
        totalChaptersCreated++;
        const avgLab = computeAvgLab(slice.items);
        const palette = mergePalettesToFive(slice.items.map((p) => p.palette));
        const mood = classifyAestheticMood(avgLab, palette);
        const occasion = pickTopOccasion(slice.items);
        const chapterSignals = buildClusterSignalBreakdown(slice.items);
        const chapterSubtitle =
          occasion && occasion.toLowerCase() !== mood.toLowerCase()
            ? `${occasion} & ${mood}`
            : mood;

        const hash = deterministicHash([
          'chapter',
          evt.eventName.toLowerCase(),
          formatYearMonth(slice.items[0].asset.localDateTime),
          mood.toLowerCase(),
          String(idx),
        ]);

        const proposedTitle = formatAlbumTitle(settings, {
          startDate: slice.items[0].asset.localDateTime,
          eventName: evt.eventName,
          isMaster: false,
          chapterSubtitle,
          clusterType: 'chapter',
          locationLabel: evt.locationLabel,
        });

        const prev = existingByHash.get(hash);
        const syncInfo = syncMapByHash.get(hash);
        const hasNewUnsynced = syncInfo ? slice.items.length > syncInfo.count : false;

        moodDistribution[mood] = (moodDistribution[mood] || 0) + 1;

        nextClusters.push({
          id: `${evt.id}-ch-${idx + 1}`,
          clusterHash: hash,
          parentEventId: evt.id,
          parentEventName: evt.eventName,
          clusterType: 'chapter',
          title: prev?.title || proposedTitle,
          proposedTitle,
          locationLabel: evt.locationLabel,
          moodLabel: mood,
          occasionLabel: occasion,
          startDate: slice.items[0].asset.localDateTime,
          endDate: slice.items[slice.items.length - 1].asset.localDateTime,
          palette,
          avgLab,
          emdBoundaryScore: slice.boundaryEmd,
          signalBreakdown: chapterSignals,
          status:
            prev?.status === 'discarded'
              ? 'discarded'
              : syncInfo && !hasNewUnsynced
                ? 'synced'
                : prev?.status === 'approved'
                  ? 'approved'
                  : 'pending',
          immichAlbumId: syncInfo?.albumId || prev?.immich_album_id || null,
          syncedAssetCount: syncInfo?.count || prev?.synced_asset_count || 0,
          assetIds: slice.items.map((p) => p.asset.id),
          emdSeries: points.filter((p) => p.chapterIndex === idx),
        });
      });
    }
  }

  // Persist generated clusters in SQLite
  const nowIso = new Date().toISOString();
  const insertCluster = db.prepare(`
    INSERT INTO clusters (
      id, cluster_hash, parent_event_id, parent_event_name, cluster_type,
      title, proposed_title, location_label, mood_label, occasion_label,
      start_date, end_date, palette_json, avg_lab_json, emd_boundary_score,
      signal_breakdown_json, status, immich_album_id, synced_asset_count, asset_ids_json, emd_series_json, updated_at
    ) VALUES (
      @id, @cluster_hash, @parent_event_id, @parent_event_name, @cluster_type,
      @title, @proposed_title, @location_label, @mood_label, @occasion_label,
      @start_date, @end_date, @palette_json, @avg_lab_json, @emd_boundary_score,
      @signal_breakdown_json, @status, @immich_album_id, @synced_asset_count, @asset_ids_json, @emd_series_json, @updated_at
    )
  `);

  db.transaction(() => {
    db.prepare('DELETE FROM clusters').run();
    for (const c of nextClusters) {
      insertCluster.run({
        id: c.id,
        cluster_hash: c.clusterHash,
        parent_event_id: c.parentEventId,
        parent_event_name: c.parentEventName,
        cluster_type: c.clusterType,
        title: c.title,
        proposed_title: c.proposedTitle,
        location_label: c.locationLabel,
        mood_label: c.moodLabel,
        occasion_label: c.occasionLabel,
        start_date: c.startDate,
        end_date: c.endDate,
        palette_json: JSON.stringify(c.palette),
        avg_lab_json: JSON.stringify(c.avgLab),
        emd_boundary_score: c.emdBoundaryScore,
        signal_breakdown_json: JSON.stringify(c.signalBreakdown),
        status: c.status,
        immich_album_id: c.immichAlbumId,
        synced_asset_count: c.syncedAssetCount,
        asset_ids_json: JSON.stringify(c.assetIds),
        emd_series_json: JSON.stringify(c.emdSeries),
        updated_at: nowIso,
      });
    }
  })();

  const stage3: Stage3Stats = {
    eventsEvaluated: rawEvents.length,
    sceneSplitsDetected,
    totalChaptersCreated,
    moodDistribution,
    signalUsage,
  };

  const summary: PipelineRunSummary = {
    runAt: nowIso,
    durationMs: Math.max(1, Date.now() - startedAt),
    stage1,
    stage2,
    stage3,
    totalProposedAlbums: nextClusters.length,
    eventTimelines,
  };

  savePipelineSummary(summary);
  saveSettings({ lastScanAt: nowIso });

  return {
    summary,
    clusters: getAllClusters(true),
  };
}

/**
 * Merges two or more selected clusters into one combined cluster in SQLite.
 */
export function mergeClusters(clusterIds: string[], customTitle?: string): ClusterRecord {
  if (clusterIds.length < 2) {
    throw new Error('Select at least 2 clusters to merge.');
  }
  const db = getDb();
  const all = getAllClusters(true);
  const selected = all.filter((c) => clusterIds.includes(c.id));
  if (selected.length < 2) {
    throw new Error('Selected clusters not found.');
  }

  const assetMap = new Map<string, AssetRecord>();
  for (const c of selected) {
    for (const a of c.assets || []) {
      assetMap.set(a.id, a);
    }
  }
  const mergedAssets = Array.from(assetMap.values()).sort(
    (x, y) => new Date(x.localDateTime).getTime() - new Date(y.localDateTime).getTime()
  );

  const palettes = mergedAssets.map((a) => a.palette).filter((p) => p.length > 0);
  const mergedPalette = mergePalettesToFive(palettes);
  const labs = mergedAssets.map((a) => a.avgLab).filter((x): x is LabMean => Boolean(x));
  const avgL = labs.reduce((s, x) => s + x.l, 0) / Math.max(1, labs.length);
  const avgA = labs.reduce((s, x) => s + x.a, 0) / Math.max(1, labs.length);
  const avgB = labs.reduce((s, x) => s + x.b, 0) / Math.max(1, labs.length);
  const avgLab: LabMean = {
    l: Number(avgL.toFixed(1)),
    a: Number(avgA.toFixed(1)),
    b: Number(avgB.toFixed(1)),
    chroma: Number(Math.hypot(avgA, avgB).toFixed(1)),
  };
  const mood = classifyAestheticMood(avgLab, mergedPalette);

  const primary = selected[0];
  const mergedId = `merged-${Date.now()}`;
  const mergedTitle = customTitle?.trim() || `${primary.title} (Merged)`;
  const hash = deterministicHash(['merged', ...selected.map((s) => s.clusterHash).sort()]);
  const now = new Date().toISOString();

  db.transaction(() => {
    const del = db.prepare('DELETE FROM clusters WHERE id = ?');
    for (const s of selected) {
      del.run(s.id);
    }
    db.prepare(`
      INSERT INTO clusters (
        id, cluster_hash, parent_event_id, parent_event_name, cluster_type,
        title, proposed_title, location_label, mood_label, occasion_label,
        start_date, end_date, palette_json, avg_lab_json, emd_boundary_score,
        status, immich_album_id, synced_asset_count, asset_ids_json, emd_series_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, '[]', ?)
    `).run(
      mergedId,
      hash,
      primary.parentEventId,
      primary.parentEventName,
      primary.clusterType === 'chapter' ? 'trip' : primary.clusterType,
      mergedTitle,
      mergedTitle,
      primary.locationLabel,
      mood,
      primary.occasionLabel,
      mergedAssets[0]?.localDateTime || primary.startDate,
      mergedAssets[mergedAssets.length - 1]?.localDateTime || primary.endDate,
      JSON.stringify(mergedPalette),
      JSON.stringify(avgLab),
      primary.emdBoundaryScore,
      JSON.stringify(mergedAssets.map((a) => a.id)),
      now
    );
  })();

  const result = getAllClusters(true).find((c) => c.id === mergedId);
  if (!result) throw new Error('Failed to create merged cluster.');
  return result;
}

/**
 * Manually splits a cluster into two separate chapters at a user-chosen photo index.
 */
export function splitClusterAtIndex(clusterId: string, splitIndex: number): ClusterRecord[] {
  const db = getDb();
  const target = getAllClusters(true).find((c) => c.id === clusterId);
  if (!target || !target.assets) {
    throw new Error('Cluster not found.');
  }
  if (splitIndex < 1 || splitIndex >= target.assets.length) {
    throw new Error('Split index must leave at least 1 photo on each side.');
  }

  const parts = [target.assets.slice(0, splitIndex), target.assets.slice(splitIndex)];
  const now = new Date().toISOString();
  const createdIds: string[] = [];

  db.transaction(() => {
    db.prepare('DELETE FROM clusters WHERE id = ?').run(clusterId);
    parts.forEach((partAssets, idx) => {
      const palettes = partAssets.map((a) => a.palette).filter((p) => p.length > 0);
      const pal = mergePalettesToFive(palettes);
      const labs = partAssets.map((a) => a.avgLab).filter((x): x is LabMean => Boolean(x));
      const avgL = labs.reduce((s, x) => s + x.l, 0) / Math.max(1, labs.length);
      const avgA = labs.reduce((s, x) => s + x.a, 0) / Math.max(1, labs.length);
      const avgB = labs.reduce((s, x) => s + x.b, 0) / Math.max(1, labs.length);
      const avgLab: LabMean = {
        l: Number(avgL.toFixed(1)),
        a: Number(avgA.toFixed(1)),
        b: Number(avgB.toFixed(1)),
        chroma: Number(Math.hypot(avgA, avgB).toFixed(1)),
      };
      const mood = classifyAestheticMood(avgLab, pal);
      const newId = `${clusterId}-part-${idx + 1}-${Date.now()}`;
      createdIds.push(newId);
      const newTitle = `${target.title.replace(/\s*\(All\)$/, '')} — Part ${idx + 1} (${mood})`;
      const hash = deterministicHash([target.clusterHash, 'split', String(idx), String(splitIndex)]);

      db.prepare(`
        INSERT INTO clusters (
          id, cluster_hash, parent_event_id, parent_event_name, cluster_type,
          title, proposed_title, location_label, mood_label, occasion_label,
          start_date, end_date, palette_json, avg_lab_json, emd_boundary_score,
          status, immich_album_id, synced_asset_count, asset_ids_json, emd_series_json, updated_at
        ) VALUES (?, ?, ?, ?, 'chapter', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, '[]', ?)
      `).run(
        newId,
        hash,
        target.parentEventId,
        target.parentEventName,
        newTitle,
        newTitle,
        target.locationLabel,
        mood,
        target.occasionLabel,
        partAssets[0].localDateTime,
        partAssets[partAssets.length - 1].localDateTime,
        JSON.stringify(pal),
        JSON.stringify(avgLab),
        target.emdBoundaryScore,
        JSON.stringify(partAssets.map((a) => a.id)),
        now
      );
    });
  })();

  return getAllClusters(true).filter((c) => createdIds.includes(c.id));
}

/**
 * Idempotently syncs a cluster to Immich (or local SQLite sync ledger if Immich env is unset).
 * Re-runs for an already-mapped cluster_hash append only newly added assets via PUT /albums/{id}/assets.
 */
export async function syncClusterIdempotent(clusterId: string): Promise<{
  cluster: ClusterRecord;
  history: SyncHistoryRecord;
}> {
  const db = getDb();
  const cluster = getAllClusters(false).find((c) => c.id === clusterId);
  if (!cluster) {
    throw new Error('Cluster not found.');
  }

  const immichStatus = await checkImmichStatus();
  const isLive = immichStatus.configured && immichStatus.reachable;

  const existingMap = db
    .prepare('SELECT * FROM sync_mappings WHERE cluster_hash = ?')
    .get(cluster.clusterHash) as
    | {
        cluster_hash: string;
        immich_album_id: string;
        album_title: string;
        synced_asset_ids_json: string;
      }
    | undefined;

  const now = new Date().toISOString();
  let immichAlbumId: string;
  let action: 'created' | 'appended';
  let addedCount: number;
  let mergedIds: string[];

  if (existingMap) {
    const prevIds = new Set<string>(JSON.parse(existingMap.synced_asset_ids_json || '[]'));
    const newIds = cluster.assetIds.filter((id) => !prevIds.has(id));
    immichAlbumId = existingMap.immich_album_id;
    action = 'appended';
    addedCount = newIds.length;
    mergedIds = Array.from(new Set([...prevIds, ...cluster.assetIds]));

    if (isLive && newIds.length > 0) {
      await appendLiveImmichAlbumAssets(immichAlbumId, newIds);
    }

    db.prepare(
      'UPDATE sync_mappings SET album_title = ?, synced_asset_ids_json = ?, updated_at = ? WHERE cluster_hash = ?'
    ).run(cluster.title, JSON.stringify(mergedIds), now, cluster.clusterHash);
  } else {
    action = 'created';
    addedCount = cluster.assetIds.length;
    mergedIds = [...cluster.assetIds];

    if (isLive) {
      const created = await createLiveImmichAlbum(
        cluster.title,
        `Auto-organized by ChromaCluster (${cluster.moodLabel} · ${cluster.locationLabel})`,
        cluster.assetIds
      );
      immichAlbumId = created.id;
    } else {
      immichAlbumId = `immich-alb-${cluster.clusterHash.slice(0, 10)}`;
    }

    db.prepare(
      'INSERT INTO sync_mappings (cluster_hash, immich_album_id, album_title, synced_asset_ids_json, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(cluster.clusterHash, immichAlbumId, cluster.title, JSON.stringify(mergedIds), now);
  }

  db.prepare(
    'UPDATE clusters SET status = ?, immich_album_id = ?, synced_asset_count = ?, updated_at = ? WHERE id = ?'
  ).run('synced', immichAlbumId, mergedIds.length, now, cluster.id);

  const historyEntry: SyncHistoryRecord = {
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clusterId: cluster.id,
    clusterHash: cluster.clusterHash,
    immichAlbumId,
    albumTitle: cluster.title,
    action,
    addedCount,
    totalInAlbum: mergedIds.length,
    mode: isLive ? 'live_immich' : 'local_ledger',
    syncedAt: now,
  };

  db.prepare(`
    INSERT INTO sync_history (
      id, cluster_id, cluster_hash, immich_album_id, album_title,
      action, added_count, total_in_album, mode, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    historyEntry.id,
    historyEntry.clusterId,
    historyEntry.clusterHash,
    historyEntry.immichAlbumId,
    historyEntry.albumTitle,
    historyEntry.action,
    historyEntry.addedCount,
    historyEntry.totalInAlbum,
    historyEntry.mode,
    historyEntry.syncedAt
  );

  const updated = getAllClusters(true).find((c) => c.id === cluster.id)!;
  return { cluster: updated, history: historyEntry };
}
