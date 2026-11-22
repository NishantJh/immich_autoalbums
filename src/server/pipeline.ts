import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  AestheticMood,
  AssetRecord,
  ClusterRecord,
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

function pickTopOccasion(assets: EnrichedAsset[]): string | null {
  const counts = new Map<string, number>();
  const priorityLabels: Record<string, string> = {
    'wedding ceremony': 'Wedding Ceremony',
    'birthday cake': 'Birthday Celebration',
    celebration: 'Birthday Celebration',
    beach: 'Beach',
    sunset: 'Sunset',
    hiking: 'Highland Trek',
    mountains: 'Highland Trek',
    dinner: 'Dinner',
    nightlife: 'Nightlife',
    architecture: 'Architecture Walk',
    promenade: 'Promenade Walk',
    concert: 'Live Concert',
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
    } else if (isSuspectedScreenshot(a)) {
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
  //   1. Home-Base Inference (5km geohash cluster)
  //   2. Trips (outside homeRadiusKm, merged across gaps < tripGapHours)
  //   3. Local Events (density clustering on time + fine GPS + non-household faces)
  // =========================================================================
  const geohashBuckets = new Map<
    string,
    { count: number; latSum: number; lngSum: number; cities: Map<string, number> }
  >();

  for (const item of eligible) {
    const { latitude, longitude, city } = item.asset;
    if (latitude === null || longitude === null) continue;
    const gh = encodeGeohash5(latitude, longitude);
    const bucket = geohashBuckets.get(gh) || {
      count: 0,
      latSum: 0,
      lngSum: 0,
      cities: new Map(),
    };
    bucket.count++;
    bucket.latSum += latitude;
    bucket.lngSum += longitude;
    if (city) bucket.cities.set(city, (bucket.cities.get(city) || 0) + 1);
    geohashBuckets.set(gh, bucket);
  }

  let homeGeohash = 'te7ud';
  let homeLat = 19.076;
  let homeLng = 72.8777;
  let homeCity = 'Home Base';
  let homeCount = 0;

  for (const [gh, b] of geohashBuckets.entries()) {
    if (b.count > homeCount) {
      homeCount = b.count;
      homeGeohash = gh;
      homeLat = b.latSum / b.count;
      homeLng = b.lngSum / b.count;
      let topC = 'Home Base';
      let topCC = 0;
      for (const [c, cnt] of b.cities.entries()) {
        if (cnt > topCC) {
          topCC = cnt;
          topC = c;
        }
      }
      homeCity = topC;
    }
  }

  // Partition assets into Away (Trips) vs Home-Radius (Local Events)
  const awayAssets: EnrichedAsset[] = [];
  const homeAssets: EnrichedAsset[] = [];

  for (const item of eligible) {
    const { latitude, longitude } = item.asset;
    if (latitude !== null && longitude !== null && homeCount > 0) {
      const distKm = haversineKm(homeLat, homeLng, latitude, longitude);
      if (distKm > settings.homeRadiusKm) {
        awayAssets.push(item);
      } else {
        homeAssets.push(item);
      }
    } else {
      homeAssets.push(item);
    }
  }

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

  interface RawEvent {
    id: string;
    type: 'trip' | 'local_event';
    assets: EnrichedAsset[];
    locationLabel: string;
    eventName: string;
  }

  const rawEvents: RawEvent[] = [];
  let unclusteredNoiseCount = 0;

  // 2A. Macro Trip Clustering (outside home radius, consecutive gaps < tripGapHours)
  const tripGapMs = settings.tripGapHours * 3600 * 1000;
  let currentTrip: EnrichedAsset[] = [];
  const flushTrip = () => {
    if (currentTrip.length >= settings.minPhotosPerAlbum) {
      const cityCounts = new Map<string, number>();
      for (const a of currentTrip) {
        const c = a.asset.city || a.asset.country || 'Away';
        cityCounts.set(c, (cityCounts.get(c) || 0) + 1);
      }
      const topCity =
        Array.from(cityCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || 'Away';
      const country = currentTrip.find((a) => a.asset.country)?.asset.country;
      const locationLabel = country && country !== topCity ? `${topCity}, ${country}` : topCity;
      rawEvents.push({
        id: `evt-trip-${topCity.toLowerCase().replace(/[^a-z0-9]/g, '')}-${formatYearMonth(currentTrip[0].asset.localDateTime)}`,
        type: 'trip',
        assets: [...currentTrip],
        locationLabel,
        eventName: `${topCity} Trip`,
      });
    } else {
      unclusteredNoiseCount += currentTrip.length;
    }
    currentTrip = [];
  };

  for (const item of awayAssets) {
    if (currentTrip.length === 0) {
      currentTrip.push(item);
      continue;
    }
    const prev = currentTrip[currentTrip.length - 1];
    const gap = item.timestampMs - prev.timestampMs;
    const sameRegion =
      prev.asset.latitude !== null &&
      item.asset.latitude !== null &&
      haversineKm(
        prev.asset.latitude,
        prev.asset.longitude!,
        item.asset.latitude,
        item.asset.longitude!
      ) < 120;

    if (gap <= tripGapMs && (sameRegion || prev.asset.city === item.asset.city)) {
      currentTrip.push(item);
    } else {
      flushTrip();
      currentTrip.push(item);
    }
  }
  flushTrip();

  // 2B. Local Home-City Event Discovery (HDBSCAN-inspired spatiotemporal + face density)
  const localGapMs = settings.localEventGapHours * 3600 * 1000;
  const fineRadiusKm = settings.localEventRadiusMeters / 1000;
  const visited = new Set<number>();
  const minClusterPts = Math.max(3, settings.minPhotosPerAlbum);

  const areLocalNeighbors = (a: EnrichedAsset, b: EnrichedAsset): boolean => {
    const dt = Math.abs(a.timestampMs - b.timestampMs);
    if (dt > localGapMs) return false;

    let spatialClose = true;
    if (
      a.asset.latitude !== null &&
      a.asset.longitude !== null &&
      b.asset.latitude !== null &&
      b.asset.longitude !== null
    ) {
      const dKm = haversineKm(
        a.asset.latitude,
        a.asset.longitude,
        b.asset.latitude,
        b.asset.longitude
      );
      spatialClose = dKm <= fineRadiusKm * 2.5;
    }

    const aGuests = a.asset.peopleIds.filter((p) => !householdPeople.has(p));
    const bGuests = b.asset.peopleIds.filter((p) => !householdPeople.has(p));
    const sharesGuest = aGuests.some((g) => bGuests.includes(g));

    return spatialClose || (sharesGuest && dt <= localGapMs);
  };

  let localIdx = 1;
  for (let i = 0; i < homeAssets.length; i++) {
    if (visited.has(i)) continue;
    const queue = [i];
    const component: number[] = [];
    visited.add(i);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (let j = 0; j < homeAssets.length; j++) {
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
      const occasion = pickTopOccasion(members) || `Local Gathering #${localIdx}`;
      const city = members.find((m) => m.asset.city)?.asset.city || homeCity;
      const country = members.find((m) => m.asset.country)?.asset.country;
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
    homeBaseGeohash: homeGeohash,
    homeBaseLat: Number(homeLat.toFixed(4)),
    homeBaseLng: Number(homeLng.toFixed(4)),
    homeBaseAssetCount: homeCount,
    householdPeopleIds: Array.from(householdPeople),
    macroTripCount: rawEvents.filter((e) => e.type === 'trip').length,
    localEventCount: rawEvents.filter((e) => e.type === 'local_event').length,
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

    for (let i = 0; i < photos.length; i++) {
      let emdScore = 0;
      let gapMinutes = 0;

      if (i > 0) {
        gapMinutes = Number(
          ((photos[i].timestampMs - photos[i - 1].timestampMs) / 60000).toFixed(1)
        );
        const beforeStart = Math.max(0, i - windowSize);
        const afterEnd = Math.min(photos.length, i + windowSize);
        const hBefore = averageHistograms(
          photos.slice(beforeStart, i).map((p) => p.histogram)
        );
        const hAfter = averageHistograms(
          photos.slice(i, afterEnd).map((p) => p.histogram)
        );
        emdScore = computeLabHistogramEmd(hBefore, hAfter);
      }

      const lastSplit = splitIndices.length > 0 ? splitIndices[splitIndices.length - 1] : 0;
      const enoughBefore = i - lastSplit >= 4;
      const enoughAfter = photos.length - i >= 4;
      const isSplitBoundary =
        settings.createMoodSubalbums &&
        i > 0 &&
        enoughBefore &&
        enoughAfter &&
        emdScore >= settings.emdThreshold &&
        gapMinutes >= settings.sceneSplitGapMins;

      if (isSplitBoundary) {
        splitIndices.push(i);
        sceneSplitsDetected++;
      }

      points.push({
        index: i,
        assetId: photos[i].asset.id,
        fileName: photos[i].asset.fileName,
        timestamp: photos[i].asset.localDateTime,
        emdScore,
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
        boundaryEmd: cursor === 0 ? 0 : points[cursor]?.emdScore || 0,
      });
      cursor = splitIdx;
    }
    slices.push({
      items: photos.slice(cursor),
      boundaryEmd: cursor === 0 ? 0 : points[cursor]?.emdScore || 0,
    });

    const hasSubChapters = slices.length > 1;
    const masterAvgLab = computeAvgLab(photos);
    const masterPalette = mergePalettesToFive(photos.map((p) => p.palette));
    const masterMood = classifyAestheticMood(masterAvgLab, masterPalette);
    const masterOccasion = pickTopOccasion(photos);

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
        emdBoundaryScore: Math.max(...points.map((p) => p.emdScore), 0),
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

    // Color-Tone / Theme Sub-Chapter Albums (overlapping multi-album assignment!)
    if (hasSubChapters) {
      slices.forEach((slice, idx) => {
        totalChaptersCreated++;
        const avgLab = computeAvgLab(slice.items);
        const palette = mergePalettesToFive(slice.items.map((p) => p.palette));
        const mood = classifyAestheticMood(avgLab, palette);
        const occasion = pickTopOccasion(slice.items);
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
      status, immich_album_id, synced_asset_count, asset_ids_json, emd_series_json, updated_at
    ) VALUES (
      @id, @cluster_hash, @parent_event_id, @parent_event_name, @cluster_type,
      @title, @proposed_title, @location_label, @mood_label, @occasion_label,
      @start_date, @end_date, @palette_json, @avg_lab_json, @emd_boundary_score,
      @status, @immich_album_id, @synced_asset_count, @asset_ids_json, @emd_series_json, @updated_at
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
