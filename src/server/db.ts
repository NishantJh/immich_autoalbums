import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type {
  AssetRecord,
  ClusterRecord,
  LabHistogram,
  LabMean,
  OrganizerSettings,
  PaletteSwatch,
  PipelineRunSummary,
  SyncHistoryRecord,
} from '../shared/types.ts';

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
export const THUMBNAIL_DIR = path.join(DATA_DIR, 'thumbnails');
const DB_PATH = path.join(DATA_DIR, 'organizer.db');

export const DEFAULT_SETTINGS: OrganizerSettings = {
  homeRadiusKm: 5.0,
  tripGapHours: 36,
  localEventRadiusMeters: 150,
  localEventGapHours: 6,
  sceneSplitGapMins: 30,
  emdThreshold: 0.34,
  minPhotosPerAlbum: 6,
  titlePrefix: '',
  useStructuredPrefix: true,
  createMasterAlbum: true,
  createMoodSubalbums: true,
  excludedPaths: ['WhatsApp', 'Downloads', 'Screenshots'],
  scanIntervalHours: 6,
  lastScanAt: null,
};

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      file_name TEXT NOT NULL,
      original_path TEXT NOT NULL,
      local_date_time TEXT NOT NULL,
      city TEXT,
      country TEXT,
      latitude REAL,
      longitude REAL,
      exif_make TEXT,
      exif_model TEXT,
      width INTEGER NOT NULL DEFAULT 320,
      height INTEGER NOT NULL DEFAULT 240,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_trashed INTEGER NOT NULL DEFAULT 0,
      is_already_albumed INTEGER NOT NULL DEFAULT 0,
      is_screenshot INTEGER NOT NULL DEFAULT 0,
      excluded_reason TEXT,
      people_ids_json TEXT NOT NULL DEFAULT '[]',
      smart_tags_json TEXT NOT NULL DEFAULT '[]',
      thumbnail_file TEXT,
      lab_l REAL,
      lab_a REAL,
      lab_b REAL,
      lab_chroma REAL,
      lab_hist_json TEXT,
      palette_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      cluster_hash TEXT NOT NULL,
      parent_event_id TEXT,
      parent_event_name TEXT,
      cluster_type TEXT NOT NULL,
      title TEXT NOT NULL,
      proposed_title TEXT NOT NULL,
      location_label TEXT NOT NULL,
      mood_label TEXT NOT NULL,
      occasion_label TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      palette_json TEXT NOT NULL DEFAULT '[]',
      avg_lab_json TEXT NOT NULL,
      emd_boundary_score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      immich_album_id TEXT,
      synced_asset_count INTEGER NOT NULL DEFAULT 0,
      asset_ids_json TEXT NOT NULL DEFAULT '[]',
      emd_series_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_mappings (
      cluster_hash TEXT PRIMARY KEY,
      immich_album_id TEXT NOT NULL,
      album_title TEXT NOT NULL,
      synced_asset_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_history (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      cluster_hash TEXT NOT NULL,
      immich_album_id TEXT NOT NULL,
      album_title TEXT NOT NULL,
      action TEXT NOT NULL,
      added_count INTEGER NOT NULL,
      total_in_album INTEGER NOT NULL,
      mode TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);

  // Initialize default settings if absent
  const existingSettings = db
    .prepare('SELECT value_json FROM app_state WHERE key = ?')
    .get('settings') as { value_json: string } | undefined;

  if (!existingSettings) {
    db.prepare('INSERT INTO app_state (key, value_json) VALUES (?, ?)').run(
      'settings',
      JSON.stringify(DEFAULT_SETTINGS)
    );
  }

  dbInstance = db;
  return db;
}

export function getSettings(): OrganizerSettings {
  const db = getDb();
  const row = db
    .prepare('SELECT value_json FROM app_state WHERE key = ?')
    .get('settings') as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) };
}

export function saveSettings(partial: Partial<OrganizerSettings>): OrganizerSettings {
  const current = getSettings();
  const next: OrganizerSettings = {
    homeRadiusKm: clampNum(partial.homeRadiusKm ?? current.homeRadiusKm, 1, 50),
    tripGapHours: clampNum(partial.tripGapHours ?? current.tripGapHours, 6, 120),
    localEventRadiusMeters: clampNum(
      partial.localEventRadiusMeters ?? current.localEventRadiusMeters,
      25,
      2000
    ),
    localEventGapHours: clampNum(
      partial.localEventGapHours ?? current.localEventGapHours,
      1,
      24
    ),
    sceneSplitGapMins: clampNum(
      partial.sceneSplitGapMins ?? current.sceneSplitGapMins,
      5,
      360
    ),
    emdThreshold: clampNum(partial.emdThreshold ?? current.emdThreshold, 0.1, 0.85),
    minPhotosPerAlbum: Math.round(
      clampNum(partial.minPhotosPerAlbum ?? current.minPhotosPerAlbum, 2, 50)
    ),
    titlePrefix: String(partial.titlePrefix ?? current.titlePrefix).slice(0, 32),
    useStructuredPrefix: Boolean(
      partial.useStructuredPrefix ?? current.useStructuredPrefix
    ),
    createMasterAlbum: Boolean(partial.createMasterAlbum ?? current.createMasterAlbum),
    createMoodSubalbums: Boolean(
      partial.createMoodSubalbums ?? current.createMoodSubalbums
    ),
    excludedPaths: Array.isArray(partial.excludedPaths)
      ? partial.excludedPaths
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 30)
      : current.excludedPaths,
    scanIntervalHours: Math.round(
      clampNum(partial.scanIntervalHours ?? current.scanIntervalHours, 1, 168)
    ),
    lastScanAt:
      partial.lastScanAt !== undefined ? partial.lastScanAt : current.lastScanAt,
  };

  getDb()
    .prepare(
      'INSERT INTO app_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    .run('settings', JSON.stringify(next));

  return next;
}

function clampNum(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export interface DbAssetRow {
  id: string;
  source: 'upload' | 'immich';
  file_name: string;
  original_path: string;
  local_date_time: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  exif_make: string | null;
  exif_model: string | null;
  width: number;
  height: number;
  is_archived: number;
  is_trashed: number;
  is_already_albumed: number;
  is_screenshot: number;
  excluded_reason: string | null;
  people_ids_json: string;
  smart_tags_json: string;
  thumbnail_file: string | null;
  lab_l: number | null;
  lab_a: number | null;
  lab_b: number | null;
  lab_chroma: number | null;
  lab_hist_json: string | null;
  palette_json: string;
  created_at: string;
}

export function rowToAsset(row: DbAssetRow): AssetRecord {
  const hasLab = row.lab_l !== null && row.lab_a !== null && row.lab_b !== null;
  return {
    id: row.id,
    source: row.source,
    fileName: row.file_name,
    originalPath: row.original_path,
    localDateTime: row.local_date_time,
    city: row.city,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    exifMake: row.exif_make,
    exifModel: row.exif_model,
    width: row.width,
    height: row.height,
    isArchived: Boolean(row.is_archived),
    isTrashed: Boolean(row.is_trashed),
    isAlreadyAlbumed: Boolean(row.is_already_albumed),
    isScreenshot: Boolean(row.is_screenshot),
    excludedReason: row.excluded_reason,
    peopleIds: JSON.parse(row.people_ids_json || '[]'),
    smartTags: JSON.parse(row.smart_tags_json || '[]'),
    thumbnailUrl: `/api/assets/${encodeURIComponent(row.id)}/thumbnail`,
    avgLab: hasLab
      ? {
          l: row.lab_l!,
          a: row.lab_a!,
          b: row.lab_b!,
          chroma: row.lab_chroma ?? Math.hypot(row.lab_a!, row.lab_b!),
        }
      : null,
    palette: JSON.parse(row.palette_json || '[]') as PaletteSwatch[],
    cachedFeature: Boolean(row.lab_hist_json),
  };
}

export function getAllAssetsWithHist(): Array<{
  asset: AssetRecord;
  histogram: LabHistogram | null;
  thumbnailFile: string | null;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM assets ORDER BY local_date_time ASC')
    .all() as DbAssetRow[];

  return rows.map((row) => ({
    asset: rowToAsset(row),
    histogram: row.lab_hist_json ? (JSON.parse(row.lab_hist_json) as LabHistogram) : null,
    thumbnailFile: row.thumbnail_file,
  }));
}

export function getAllAssets(): AssetRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM assets ORDER BY local_date_time ASC')
    .all() as DbAssetRow[];
  return rows.map(rowToAsset);
}

export function savePipelineSummary(summary: PipelineRunSummary): void {
  getDb()
    .prepare(
      'INSERT INTO app_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    .run('pipeline_summary', JSON.stringify(summary));
}

export function getPipelineSummary(): PipelineRunSummary | null {
  const row = getDb()
    .prepare('SELECT value_json FROM app_state WHERE key = ?')
    .get('pipeline_summary') as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as PipelineRunSummary) : null;
}

export function getAllClusters(includeAssets = true): ClusterRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM clusters ORDER BY start_date DESC, parent_event_id ASC, id ASC')
    .all() as Array<{
    id: string;
    cluster_hash: string;
    parent_event_id: string | null;
    parent_event_name: string | null;
    cluster_type: 'trip' | 'local_event' | 'chapter';
    title: string;
    proposed_title: string;
    location_label: string;
    mood_label: ClusterRecord['moodLabel'];
    occasion_label: string | null;
    start_date: string;
    end_date: string;
    palette_json: string;
    avg_lab_json: string;
    emd_boundary_score: number;
    status: ClusterRecord['status'];
    immich_album_id: string | null;
    synced_asset_count: number;
    asset_ids_json: string;
    emd_series_json: string;
    updated_at: string;
  }>;

  const assetMap = new Map<string, AssetRecord>();
  if (includeAssets) {
    for (const a of getAllAssets()) {
      assetMap.set(a.id, a);
    }
  }

  return rows.map((r) => {
    const assetIds = JSON.parse(r.asset_ids_json || '[]') as string[];
    return {
      id: r.id,
      clusterHash: r.cluster_hash,
      parentEventId: r.parent_event_id,
      parentEventName: r.parent_event_name,
      clusterType: r.cluster_type,
      title: r.title,
      proposedTitle: r.proposed_title,
      locationLabel: r.location_label,
      moodLabel: r.mood_label,
      occasionLabel: r.occasion_label,
      startDate: r.start_date,
      endDate: r.end_date,
      palette: JSON.parse(r.palette_json || '[]') as PaletteSwatch[],
      avgLab: JSON.parse(r.avg_lab_json) as LabMean,
      emdBoundaryScore: r.emd_boundary_score,
      status: r.status,
      immichAlbumId: r.immich_album_id,
      syncedAssetCount: r.synced_asset_count,
      assetIds,
      assets: includeAssets
        ? assetIds.map((id) => assetMap.get(id)).filter((x): x is AssetRecord => Boolean(x))
        : undefined,
      emdSeries: JSON.parse(r.emd_series_json || '[]'),
      updatedAt: r.updated_at,
    };
  });
}

export function getSyncHistory(): SyncHistoryRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM sync_history ORDER BY synced_at DESC LIMIT 100')
    .all() as Array<{
    id: string;
    cluster_id: string;
    cluster_hash: string;
    immich_album_id: string;
    album_title: string;
    action: 'created' | 'appended';
    added_count: number;
    total_in_album: number;
    mode: 'live_immich' | 'local_ledger';
    synced_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clusterId: r.cluster_id,
    clusterHash: r.cluster_hash,
    immichAlbumId: r.immich_album_id,
    albumTitle: r.album_title,
    action: r.action,
    addedCount: r.added_count,
    totalInAlbum: r.total_in_album,
    mode: r.mode,
    syncedAt: r.synced_at,
  }));
}

const LEGACY_DEMO_THUMB_PREFIXES = [
  'asset-home-anchor-',
  'asset-goa-',
  'asset-munnar-',
  'asset-mumbai-',
  'asset-filter-',
];

function safeUnlinkThumbnail(fileName: string | null | undefined): boolean {
  if (!fileName) return false;
  const safeBase = path.basename(fileName);
  const resolved = path.resolve(THUMBNAIL_DIR, safeBase);
  if (!resolved.startsWith(THUMBNAIL_DIR + path.sep)) return false;
  if (!fs.existsSync(resolved)) return false;
  try {
    fs.unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes any legacy demo ('sample') rows and deletes their cached PNG thumbnails from disk.
 * Ensures existing Unraid/Docker appdata directories are cleaned automatically on upgrade.
 */
export function purgeDemoAssets(): number {
  const db = getDb();
  const sampleRows = db
    .prepare("SELECT id, thumbnail_file FROM assets WHERE source = 'sample'")
    .all() as Array<{ id: string; thumbnail_file: string | null }>;

  let removedFiles = 0;
  for (const row of sampleRows) {
    if (safeUnlinkThumbnail(row.thumbnail_file)) {
      removedFiles++;
    }
  }

  if (fs.existsSync(THUMBNAIL_DIR)) {
    for (const entry of fs.readdirSync(THUMBNAIL_DIR)) {
      if (LEGACY_DEMO_THUMB_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
        if (safeUnlinkThumbnail(entry)) {
          removedFiles++;
        }
      }
    }
  }

  if (sampleRows.length > 0) {
    db.transaction(() => {
      db.prepare("DELETE FROM assets WHERE source = 'sample'").run();
      const remaining = db.prepare('SELECT COUNT(*) as c FROM assets').get() as { c: number };
      if (remaining.c === 0) {
        db.prepare('DELETE FROM clusters').run();
        db.prepare("DELETE FROM sync_history WHERE mode = 'local_ledger'").run();
        db.prepare("DELETE FROM sync_mappings WHERE immich_album_id LIKE 'immich-alb-%'").run();
      }
    })();
  }

  return sampleRows.length + removedFiles;
}

/**
 * Clears all locally cached assets, clusters, and thumbnails without modifying Immich or saved credentials.
 */
export function clearLocalLibraryCache(): number {
  const db = getDb();
  const rows = db
    .prepare('SELECT thumbnail_file FROM assets')
    .all() as Array<{ thumbnail_file: string | null }>;

  for (const row of rows) {
    safeUnlinkThumbnail(row.thumbnail_file);
  }

  if (fs.existsSync(THUMBNAIL_DIR)) {
    for (const entry of fs.readdirSync(THUMBNAIL_DIR)) {
      safeUnlinkThumbnail(entry);
    }
  }

  db.transaction(() => {
    db.prepare('DELETE FROM assets').run();
    db.prepare('DELETE FROM clusters').run();
    db.prepare("DELETE FROM app_state WHERE key = 'pipeline_summary'").run();
  })();

  return rows.length;
}
