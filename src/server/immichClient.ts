import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ImmichStatus, PullPhase, PullProgressState } from '../shared/types.ts';
import { decodeImageBufferToRgba, extractColorFeaturesFromPixels } from './colorLab.ts';
import { DATA_DIR, getAssetCount, getDb, getSettings, purgeDemoAssets, THUMBNAIL_DIR } from './db.ts';
import { formatDurationShort, logError, logInfo, logWarn } from './logger.ts';

let pullProgress: PullProgressState = {
  active: false,
  phase: 'idle',
  percent: 0,
  label: '',
  detail: '',
  current: 0,
  total: 0,
  cachedCount: 0,
  ingestedCount: 0,
  dbAssetCount: 0,
  etaSeconds: null,
  cancelRequested: false,
  startedAt: null,
  updatedAt: new Date().toISOString(),
  error: null,
};

let cancelRequestedFlag = false;

export function isPullRunning(): boolean {
  return pullProgress.active;
}

export function getPullProgress(): PullProgressState {
  return { ...pullProgress };
}

export function requestCancelPull(): PullProgressState {
  if (pullProgress.active) {
    cancelRequestedFlag = true;
    logWarn(
      'Immich',
      `Stop & Cluster requested during ${pullProgress.phase} (${pullProgress.percent}%) — finishing current batch and clustering saved photos`
    );
    pullProgress = {
      ...pullProgress,
      cancelRequested: true,
      detail: 'Stopping after current batch and clustering photos pulled so far...',
      updatedAt: new Date().toISOString(),
    };
  }
  return { ...pullProgress };
}

export function setPullProgress(
  patch: Partial<PullProgressState> & { phase: PullPhase }
): void {
  const now = new Date().toISOString();
  pullProgress = {
    ...pullProgress,
    ...patch,
    percent: Math.max(0, Math.min(100, Math.round(patch.percent ?? pullProgress.percent))),
    cancelRequested: cancelRequestedFlag,
    updatedAt: now,
  };
}

export function startPullProgress(label = 'Connecting to Immich'): void {
  const now = new Date().toISOString();
  cancelRequestedFlag = false;
  pullProgress = {
    active: true,
    phase: 'connecting',
    percent: 2,
    label,
    detail: 'Verifying server reachability and API key...',
    current: 0,
    total: 0,
    cachedCount: 0,
    ingestedCount: 0,
    dbAssetCount: getAssetCount(),
    etaSeconds: null,
    cancelRequested: false,
    startedAt: now,
    updatedAt: now,
    error: null,
  };
}

export function finishPullProgress(detail: string, ingestedCount?: number): void {
  cancelRequestedFlag = false;
  logInfo('Immich', `Pull & scan complete — ${detail}`);
  setPullProgress({
    active: false,
    phase: 'done',
    percent: 100,
    label: 'Pull & scan complete',
    detail,
    dbAssetCount: getAssetCount(),
    etaSeconds: null,
    ...(typeof ingestedCount === 'number' ? { ingestedCount } : {}),
    error: null,
  });
}

export function failPullProgress(errorMessage: string): void {
  cancelRequestedFlag = false;
  logError('Immich', `Pull failed: ${errorMessage}`);
  setPullProgress({
    active: false,
    phase: 'error',
    label: 'Pull interrupted',
    detail: errorMessage,
    error: errorMessage,
  });
}

interface StoredImmichConfig {
  baseUrl: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
}

function getEncryptionKey(): Buffer {
  const envSecret = (process.env.IMMICH_CONFIG_SECRET || '').trim();
  if (envSecret) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const keyFile = path.join(DATA_DIR, '.config.key');
  if (fs.existsSync(keyFile)) {
    const raw = fs.readFileSync(keyFile, 'utf8').trim();
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  }
  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, fresh.toString('hex'), { mode: 0o600 });
  return fresh;
}

function encryptSecret(plaintext: string): { iv: string; tag: string; ciphertext: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: enc.toString('hex'),
  };
}

function decryptSecret(payload: { iv: string; tag: string; ciphertext: string }): string | null {
  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'hex')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

export function normalizeApiKey(raw: string): string {
  let clean = String(raw || '')
    .replace(/[\r\n\u200B-\u200D\uFEFF]/g, '')
    .trim();
  // Strip accidental pasted header prefixes (e.g. "x-api-key: ..." or "Bearer ...")
  clean = clean.replace(/^(?:x-api-key\s*:\s*|bearer\s+)/i, '').trim();
  // Strip accidental surrounding quotes from .env or Unraid template copy-paste
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  return clean;
}

export function validateImmichUrl(rawUrl: string): { baseUrl: string; hostLabel: string } {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Immich Server URL is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid URL starting with http:// or https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Immich URL must use http:// or https://');
  }
  const hostLower = parsed.hostname.toLowerCase();
  if (
    hostLower === '169.254.169.254' ||
    hostLower.startsWith('169.254.') ||
    hostLower === 'metadata.google.internal'
  ) {
    throw new Error('Blocked metadata host address.');
  }
  // Strip trailing slashes and an optional trailing "/api" so both
  // "http://host:2283" and "http://host:2283/api" resolve cleanly.
  const normalizedPath = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  return {
    baseUrl: `${parsed.origin}${normalizedPath}`.replace(/\/+$/, ''),
    hostLabel: parsed.host,
  };
}

function maskKey(apiKey: string): string {
  const clean = normalizeApiKey(apiKey);
  if (clean.length <= 4) return '••••';
  return `••••••••${clean.slice(-4)}`;
}

// Tracks whether a given Immich baseUrl requires ?apiKey= fallback because a reverse proxy strips x-api-key
const hostAuthModeCache = new Map<string, 'header' | 'query'>();

function getSavedImmichConfig(): { baseUrl: string; apiKey: string; hostLabel: string } | null {
  const row = getDb()
    .prepare('SELECT value_json FROM app_state WHERE key = ?')
    .get('immich_connection') as { value_json: string } | undefined;
  if (!row) return null;

  try {
    const stored = JSON.parse(row.value_json) as StoredImmichConfig;
    const rawKey = decryptSecret(stored);
    if (!rawKey) return null;
    const apiKey = normalizeApiKey(rawKey);
    if (!apiKey) return null;
    const { baseUrl, hostLabel } = validateImmichUrl(stored.baseUrl);
    return { baseUrl, apiKey, hostLabel };
  } catch {
    return null;
  }
}

export function getActiveImmichKey(): string | null {
  return getConfiguredImmich()?.apiKey || null;
}

function getConfiguredImmich(): {
  baseUrl: string;
  apiKey: string;
  hostLabel: string;
  source: 'env' | 'saved';
} | null {
  const saved = getSavedImmichConfig();
  if (saved) {
    return { ...saved, source: 'saved' };
  }

  const rawUrl = (process.env.IMMICH_URL || '').trim();
  const apiKey = normalizeApiKey(process.env.IMMICH_API_KEY || '');
  if (!rawUrl || !apiKey) return null;

  try {
    const { baseUrl, hostLabel } = validateImmichUrl(rawUrl);
    return { baseUrl, apiKey, hostLabel, source: 'env' };
  } catch {
    return null;
  }
}

async function readImmichErrorDetail(res: Response): Promise<{
  isJson: boolean;
  message: string | null;
}> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text().catch(() => '');
  if (contentType.includes('application/json') || raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { message?: string | string[]; error?: string };
      const msg = Array.isArray(parsed.message)
        ? parsed.message.join(', ')
        : parsed.message || parsed.error || null;
      return { isJson: true, message: msg ? String(msg).slice(0, 180) : null };
    } catch {
      return { isJson: false, message: raw.slice(0, 140) || null };
    }
  }
  return { isJson: false, message: null };
}

export async function probeImmichConnection(
  rawBaseUrl: string,
  rawApiKey: string
): Promise<{ reachable: boolean; serverVersion: string | null; lastError: string | null }> {
  const { baseUrl } = validateImmichUrl(rawBaseUrl);
  const apiKey = normalizeApiKey(rawApiKey);
  if (!apiKey) {
    return {
      reachable: false,
      serverVersion: null,
      lastError: 'Immich API key is empty.',
    };
  }

  try {
    // 1. Check basic Immich reachability & version via public /api/server/version (no auth header)
    let versionStr = 'connected';
    let effectiveBaseUrl = baseUrl;
    let redirectHint = '';

    const verRes = await fetch(`${baseUrl}/api/server/version`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (verRes.redirected && verRes.url) {
      try {
        const redirected = new URL(verRes.url);
        const orig = new URL(baseUrl);
        if (redirected.origin !== orig.origin) {
          effectiveBaseUrl = redirected.origin;
          redirectHint = ` (redirected from ${orig.origin} to ${redirected.origin} — use ${redirected.origin} directly)`;
        }
      } catch {
        // Ignore malformed redirect URL
      }
    }

    if (verRes.ok) {
      const ct = (verRes.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const ver = (await verRes.json().catch(() => ({}))) as {
          major?: number;
          minor?: number;
          patch?: number;
        };
        if (typeof ver.major === 'number') {
          versionStr = `v${ver.major}.${ver.minor ?? 0}.${ver.patch ?? 0}`;
        }
      } else {
        return {
          reachable: false,
          serverVersion: null,
          lastError: `Server at ${baseUrl} returned HTML instead of Immich JSON (check URL or reverse proxy auth).`,
        };
      }
    }

    // 2. Validate API key against GET /api/albums (only requires album.read or all)
    const headerRes = await fetch(`${effectiveBaseUrl}/api/albums`, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (headerRes.ok) {
      hostAuthModeCache.set(baseUrl, 'header');
      return { reachable: true, serverVersion: versionStr, lastError: null };
    }

    const detail = await readImmichErrorDetail(headerRes);

    // 3. If header auth returned 401/403, test Immich's native ?apiKey= query parameter
    //    to detect reverse proxies (Nginx/Cloudflare/Traefik) stripping custom x-api-key headers
    if (headerRes.status === 401 || headerRes.status === 403) {
      const queryRes = await fetch(
        `${effectiveBaseUrl}/api/albums?apiKey=${encodeURIComponent(apiKey)}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (queryRes.ok) {
        hostAuthModeCache.set(baseUrl, 'query');
        return {
          reachable: true,
          serverVersion: `${versionStr} (via query auth)`,
          lastError: null,
        };
      }

      if (!detail.isJson) {
        return {
          reachable: false,
          serverVersion: null,
          lastError: `Reverse proxy returned HTTP ${headerRes.status} before reaching Immich${redirectHint}. Try your direct LAN URL (e.g. http://192.168.x.x:2283).`,
        };
      }

      const reason = detail.message || 'Invalid API key';
      return {
        reachable: false,
        serverVersion: null,
        lastError: `Immich HTTP ${headerRes.status}: ${reason} (key ending ${maskKey(apiKey)})${redirectHint}. Ensure this key is active in Immich Account Settings -> API Keys with asset.read, asset.view, album.read, album.create, albumAsset.create (or All).`,
      };
    }

    return {
      reachable: false,
      serverVersion: null,
      lastError: `HTTP ${headerRes.status} from ${effectiveBaseUrl}/api/albums${detail.message ? `: ${detail.message}` : ''}${redirectHint}`,
    };
  } catch (err) {
    return {
      reachable: false,
      serverVersion: null,
      lastError: err instanceof Error ? err.message : 'Unable to reach Immich server',
    };
  }
}

export async function saveImmichConnection(
  rawUrl: string,
  rawApiKey?: string
): Promise<ImmichStatus> {
  const { baseUrl } = validateImmichUrl(rawUrl);
  const existing = getConfiguredImmich();
  const apiKey = normalizeApiKey(rawApiKey || '') || existing?.apiKey || '';
  if (!apiKey) {
    throw new Error('Immich API key is required.');
  }

  const encrypted = encryptSecret(apiKey);
  const payload: StoredImmichConfig = {
    baseUrl,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      'INSERT INTO app_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    .run('immich_connection', JSON.stringify(payload));

  hostAuthModeCache.delete(baseUrl);
  return checkImmichStatus();
}

export async function clearSavedImmichConnection(): Promise<ImmichStatus> {
  getDb().prepare('DELETE FROM app_state WHERE key = ?').run('immich_connection');
  hostAuthModeCache.clear();
  return checkImmichStatus();
}

async function immichFetch(
  apiPath: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const cfg = getConfiguredImmich();
  if (!cfg) {
    throw new Error('Immich server is not configured.');
  }

  const normalizedPath = apiPath.startsWith('/api/')
    ? apiPath
    : `/api/${apiPath.replace(/^\/+/, '')}`;
  const authMode = hostAuthModeCache.get(cfg.baseUrl) || 'header';
  const separator = normalizedPath.includes('?') ? '&' : '?';
  const targetUrl =
    authMode === 'query'
      ? `${cfg.baseUrl}${normalizedPath}${separator}apiKey=${encodeURIComponent(cfg.apiKey)}`
      : `${cfg.baseUrl}${normalizedPath}`;

  const headers = new Headers(init.headers || {});
  if (authMode === 'header') {
    headers.set('x-api-key', cfg.apiKey);
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  return fetch(targetUrl, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function checkImmichStatus(): Promise<ImmichStatus> {
  const cfg = getConfiguredImmich();
  if (!cfg) {
    return {
      configured: false,
      reachable: false,
      source: null,
      baseUrl: null,
      hostLabel: null,
      maskedApiKey: null,
      serverVersion: null,
      lastError: null,
    };
  }

  const probe = await probeImmichConnection(cfg.baseUrl, cfg.apiKey);
  return {
    configured: true,
    reachable: probe.reachable,
    source: cfg.source,
    baseUrl: cfg.baseUrl,
    hostLabel: cfg.hostLabel,
    maskedApiKey: maskKey(cfg.apiKey),
    serverVersion: probe.serverVersion,
    lastError: probe.lastError,
  };
}

interface ImmichSearchItem {
  id: string;
  originalFileName?: string;
  originalPath?: string;
  localDateTime?: string;
  fileCreatedAt?: string;
  isArchived?: boolean;
  isTrashed?: boolean;
  isFavorite?: boolean;
  exifInfo?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    make?: string | null;
    model?: string | null;
    lensModel?: string | null;
    focalLength?: number | null;
    iso?: number | null;
    exifImageWidth?: number | null;
    exifImageHeight?: number | null;
  };
  people?: Array<{ id: string; name?: string | null }>;
}

const OCCASION_PROMPTS = [
  'wedding ceremony',
  'birthday party',
  'beach ocean',
  'mountain hiking',
  'restaurant dinner',
  'concert stage',
  'city architecture',
  'sunset sunrise',
  'snow skiing',
  'museum art gallery',
  'family portrait',
  'pet dog cat',
  'sports game',
  'fireworks festival',
  'coffee cafe',
  'temple monument',
  'garden flowers',
  'road trip',
];

function isWebpBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function isPngBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function detectThumbExt(buf: Buffer): 'png' | 'webp' | 'jpg' {
  if (isPngBuffer(buf)) return 'png';
  if (isWebpBuffer(buf)) return 'webp';
  return 'jpg';
}

/**
 * Ingests metadata, thumbnails, and CLIP Smart Search tags from a configured live Immich instance.
 */
export interface ImmichIngestOptions {
  /** 0 = pull all photos in Immich (up to 100,000 safety limit) */
  maxAssets?: number;
  takenAfter?: string;
  takenBefore?: string;
}

/**
 * Ingests metadata, thumbnails, CIELAB color features, and CLIP Smart Search tags
 * from a configured live Immich instance with live progress reporting and cancellation.
 */
export async function ingestFromLiveImmich(options: ImmichIngestOptions = {}): Promise<{
  ingested: number;
  smartTagsMatched: number;
  cancelled: boolean;
}> {
  startPullProgress('Connecting to Immich');

  try {
    const status = await checkImmichStatus();
    if (!status.configured || !status.reachable) {
      throw new Error(status.lastError || 'Live Immich server is not configured or unreachable.');
    }

    const settings = getSettings();
    const rawMax =
      typeof options.maxAssets === 'number' && Number.isFinite(options.maxAssets)
        ? Math.max(0, Math.round(options.maxAssets))
        : settings.maxAssetsPerPull;
    const effectiveMax = rawMax === 0 ? 150_000 : Math.min(150_000, rawMax);
    let pageSize = 1000;
    const scopeLabel = rawMax === 0 ? 'full library' : `up to ${rawMax.toLocaleString()} photos`;
    const dateRangeLabel =
      options.takenAfter || options.takenBefore
        ? ` · range ${options.takenAfter || '*'}..${options.takenBefore || '*'}`
        : '';
    logInfo(
      'Immich',
      `Connected to ${status.hostLabel || status.baseUrl} (${status.serverVersion || 'unknown version'}) — starting pull (${scopeLabel}${dateRangeLabel})`
    );
    const excludedKeywords = settings.excludedPaths.map((p) => p.toLowerCase()).filter(Boolean);
    const screenAspectRatios = [
      16 / 9,
      9 / 16,
      19.5 / 9,
      9 / 19.5,
      20 / 9,
      9 / 20,
      21 / 9,
      9 / 21,
    ];
    const looksLikeScreenshotItem = (item: ImmichSearchItem): boolean => {
      if (!settings.ignoreScreenshots) return false;
      const exif = item.exifInfo || {};
      const missingCamera = !exif.make && !exif.model;
      if (!missingCamera) return false;
      const fname = item.originalFileName || '';
      if (/screenshot|screen_shot|screen\s*capture/i.test(fname)) return true;
      const w = exif.exifImageWidth || 0;
      const h = exif.exifImageHeight || 0;
      if (w <= 0 || h <= 0) return false;
      const ratio = w / h;
      return screenAspectRatios.some((r) => Math.abs(ratio - r) < 0.035);
    };

    // 1. Collect already-albumed asset IDs across all existing Immich albums (5% -> 14%)
    setPullProgress({
      active: true,
      phase: 'albums',
      percent: 5,
      label: 'Checking existing albums',
      detail: 'Listing Immich albums to preserve your curated collections...',
      current: 0,
      total: 0,
      etaSeconds: null,
    });

    const alreadyAlbumedIds = new Set<string>();
    const albumsRes = await immichFetch('/api/albums', {}, 15000);
    if (albumsRes.ok) {
      const albums = (await albumsRes.json()) as Array<{ id: string }>;
      const totalAlbums = albums.length;
      let checkedAlbums = 0;

      if (totalAlbums > 0) {
        setPullProgress({
          active: true,
          phase: 'albums',
          percent: 6,
          label: 'Checking existing albums',
          detail: `0 / ${totalAlbums} albums inspected`,
          current: 0,
          total: totalAlbums,
        });
      }

      for (let i = 0; i < totalAlbums; i += 8) {
        if (cancelRequestedFlag) break;
        const batch = albums.slice(i, i + 8);
        await Promise.all(
          batch.map(async (album) => {
            try {
              const detailRes = await immichFetch(
                `/api/albums/${encodeURIComponent(album.id)}`,
                {},
                15000
              );
              if (detailRes.ok) {
                const detail = (await detailRes.json()) as { assets?: Array<{ id: string }> };
                for (const a of detail.assets || []) {
                  alreadyAlbumedIds.add(a.id);
                }
              }
            } catch {
              // Non-fatal
            } finally {
              checkedAlbums++;
              const pct = 6 + (checkedAlbums / Math.max(1, totalAlbums)) * 8;
              setPullProgress({
                active: true,
                phase: 'albums',
                percent: pct,
                label: 'Checking existing albums',
                detail: `${checkedAlbums} / ${totalAlbums} albums inspected (${alreadyAlbumedIds.size.toLocaleString()} already-albumed assets)`,
                current: checkedAlbums,
                total: totalAlbums,
              });
            }
          })
        );
      }
      logInfo(
        'Immich',
        `Phase 1/5 Albums: scanned ${totalAlbums.toLocaleString()} albums (${alreadyAlbumedIds.size.toLocaleString()} already-albumed assets)`
      );
    }

    // 1b. Query true total image count via GET /api/assets/statistics (never rely on per-page total=250)
    let libraryImageTotal = 0;
    if (!options.takenAfter && !options.takenBefore) {
      try {
        const statsRes = await immichFetch(
          '/api/assets/statistics?isArchived=false&isTrashed=false',
          {},
          10000
        );
        if (statsRes.ok) {
          const stats = (await statsRes.json()) as { images?: number; total?: number };
          if (typeof stats.images === 'number' && stats.images > 0) {
            libraryImageTotal = stats.images;
          } else if (typeof stats.total === 'number' && stats.total > 0) {
            libraryImageTotal = stats.total;
          }
        }
      } catch {
        // Non-fatal: older servers or proxies without /statistics will use dynamic progress
      }
    }

    // 1c. Optional lookup of recognized people names via GET /api/people (non-fatal if scope omitted)
    const personNameById = new Map<string, string>();
    try {
      const peopleRes = await immichFetch('/api/people?withHidden=false', {}, 10000);
      if (peopleRes.ok) {
        const peoplePayload = (await peopleRes.json()) as
          | Array<{ id: string; name?: string | null }>
          | { people?: Array<{ id: string; name?: string | null }> };
        const list = Array.isArray(peoplePayload)
          ? peoplePayload
          : Array.isArray(peoplePayload?.people)
            ? peoplePayload.people
            : [];
        for (const p of list) {
          if (p?.id && typeof p.name === 'string' && p.name.trim()) {
            personNameById.set(p.id, p.name.trim());
          }
        }
      }
    } catch {
      // Non-fatal: fall back to inline people[].name from /api/search/metadata
    }

    logInfo(
      'Immich',
      `Library preflight: ${libraryImageTotal > 0 ? `${libraryImageTotal.toLocaleString()} images reported` : 'dynamic pagination'} · ${personNameById.size.toLocaleString()} named people loaded`
    );

    // Prepare SQLite statements up front so EVERY metadata page is persisted immediately
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
    const db = getDb();
    const now = new Date().toISOString();
    let demoPurged = false;

    const upsertMetadata = db.prepare(`
      INSERT INTO assets (
        id, source, file_name, original_path, local_date_time,
        city, state, country, latitude, longitude,
        exif_make, exif_model, lens_model, focal_length, iso, is_favorite,
        width, height, is_archived, is_trashed, is_already_albumed,
        is_screenshot, excluded_reason, people_ids_json, people_names_json, smart_tags_json,
        thumbnail_file, lab_l, lab_a, lab_b, lab_chroma, lab_hist_json, palette_json, created_at
      ) VALUES (
        @id, 'immich', @file_name, @original_path, @local_date_time,
        @city, @state, @country, @latitude, @longitude,
        @exif_make, @exif_model, @lens_model, @focal_length, @iso, @is_favorite,
        @width, @height, @is_archived, @is_trashed, @is_already_albumed,
        0, NULL, @people_ids_json, @people_names_json, '[]',
        NULL, NULL, NULL, NULL, NULL, NULL, '[]', @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        city = excluded.city,
        state = excluded.state,
        country = excluded.country,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        exif_make = excluded.exif_make,
        exif_model = excluded.exif_model,
        lens_model = excluded.lens_model,
        focal_length = excluded.focal_length,
        iso = excluded.iso,
        is_favorite = excluded.is_favorite,
        is_archived = excluded.is_archived,
        is_trashed = excluded.is_trashed,
        is_already_albumed = excluded.is_already_albumed,
        people_ids_json = excluded.people_ids_json,
        people_names_json = excluded.people_names_json
    `);

    const updateSmartTagsStmt = db.prepare('UPDATE assets SET smart_tags_json = ? WHERE id = ?');
    const updateThumbLabStmt = db.prepare(`
      UPDATE assets
      SET thumbnail_file = COALESCE(@thumbnail_file, thumbnail_file),
          lab_l = COALESCE(@lab_l, lab_l),
          lab_a = COALESCE(@lab_a, lab_a),
          lab_b = COALESCE(@lab_b, lab_b),
          lab_chroma = COALESCE(@lab_chroma, lab_chroma),
          lab_hist_json = COALESCE(@lab_hist_json, lab_hist_json),
          palette_json = COALESCE(@palette_json, palette_json)
      WHERE id = @id
    `);

    const persistMetadataItems = db.transaction((itemsToSave: ImmichSearchItem[]) => {
      for (const item of itemsToSave) {
        const exif = item.exifInfo || {};
        const rawLat = typeof exif.latitude === 'number' ? exif.latitude : null;
        const rawLng = typeof exif.longitude === 'number' ? exif.longitude : null;
        const hasValidCoords =
          rawLat !== null &&
          rawLng !== null &&
          Number.isFinite(rawLat) &&
          Number.isFinite(rawLng) &&
          rawLat >= -90 &&
          rawLat <= 90 &&
          rawLng >= -180 &&
          rawLng <= 180 &&
          !(Math.abs(rawLat) < 0.001 && Math.abs(rawLng) < 0.001);

        const rawCity = typeof exif.city === 'string' ? exif.city.trim() : '';
        const rawState = typeof exif.state === 'string' ? exif.state.trim() : '';
        const rawCountry = typeof exif.country === 'string' ? exif.country.trim() : '';
        const isCyrillicCountry =
          /russia|belarus|ukraine|kazakhstan|kyrgyzstan|bulgaria|serbia|macedonia|mongolia|tajikistan|uzbekistan|montenegro|bosnia/i.test(
            rawCountry
          );
        const hasCyrillic = (s: string) => /[\u0400-\u04FF]/.test(s);
        let resolvedCity: string | null = rawCity || null;
        if (resolvedCity && !isCyrillicCountry && hasCyrillic(resolvedCity)) {
          resolvedCity = null;
        }
        if (resolvedCity && rawCountry && resolvedCity.toLowerCase() === rawCountry.toLowerCase()) {
          resolvedCity = null;
        }
        const resolvedState =
          rawState &&
          !(!isCyrillicCountry && hasCyrillic(rawState)) &&
          (!rawCountry || rawState.toLowerCase() !== rawCountry.toLowerCase())
            ? rawState
            : null;

        const peopleList = item.people || [];
        const peopleIds: string[] = [];
        const peopleNames: string[] = [];
        for (const p of peopleList) {
          if (!p?.id) continue;
          peopleIds.push(p.id);
          const resolvedName =
            (typeof p.name === 'string' && p.name.trim()) || personNameById.get(p.id) || '';
          if (resolvedName) peopleNames.push(resolvedName);
        }

        const origPath = item.originalPath || `/immich/${item.originalFileName || item.id}`;
        upsertMetadata.run({
          id: item.id,
          file_name: item.originalFileName || `${item.id}.jpg`,
          original_path: origPath,
          local_date_time: item.localDateTime || item.fileCreatedAt || now,
          city: resolvedCity,
          state: resolvedState,
          country: rawCountry || null,
          latitude: hasValidCoords ? rawLat : null,
          longitude: hasValidCoords ? rawLng : null,
          exif_make: exif.make || null,
          exif_model: exif.model || null,
          lens_model:
            typeof exif.lensModel === 'string' && exif.lensModel.trim()
              ? exif.lensModel.trim()
              : null,
          focal_length:
            typeof exif.focalLength === 'number' && Number.isFinite(exif.focalLength)
              ? exif.focalLength
              : null,
          iso: typeof exif.iso === 'number' && Number.isFinite(exif.iso) ? Math.round(exif.iso) : null,
          is_favorite: item.isFavorite ? 1 : 0,
          width: exif.exifImageWidth || 1600,
          height: exif.exifImageHeight || 1200,
          is_archived: item.isArchived ? 1 : 0,
          is_trashed: item.isTrashed ? 1 : 0,
          is_already_albumed: alreadyAlbumedIds.has(item.id) ? 1 : 0,
          people_ids_json: JSON.stringify(peopleIds),
          people_names_json: JSON.stringify(peopleNames),
          created_at: now,
        });
      }
    });

    // 2. Paginate POST /api/search/metadata excluding archived & trashed (14% -> 36%)
    //    Saves EVERY page immediately to SQLite so stopping early still clusters all pulled photos!
    const collected: ImmichSearchItem[] = [];
    const seenIds = new Set<string>();
    let estimatedTotal =
      rawMax > 0
        ? libraryImageTotal > 0
          ? Math.min(rawMax, libraryImageTotal)
          : rawMax
        : libraryImageTotal;
    const metaStartedAt = Date.now();

    setPullProgress({
      active: true,
      phase: 'metadata',
      percent: 14,
      label: 'Fetching photo metadata',
      detail:
        estimatedTotal > 0
          ? `Page 1 · 0 / ${estimatedTotal.toLocaleString()} photos indexed`
          : rawMax === 0
            ? 'Scanning full Immich library (page 1)...'
            : `Fetching up to ${rawMax.toLocaleString()} photos (page 1)...`,
      current: 0,
      total: estimatedTotal,
      dbAssetCount: getAssetCount(),
      etaSeconds: null,
    });

    const maxPages = Math.ceil(effectiveMax / 250) + 5;
    let nextPageNum = 1;
    let savedToDbCount = 0;
    let lastMetaLogAt = 0;

    for (let step = 0; step < maxPages; step++) {
      if (cancelRequestedFlag || collected.length >= effectiveMax) break;

      const buildBody = () => {
        const body: Record<string, unknown> = {
          isArchived: false,
          isTrashed: false,
          type: 'IMAGE',
          withExif: true,
          withPeople: true,
          page: nextPageNum,
          size: pageSize,
        };
        if (options.takenAfter) body.takenAfter = options.takenAfter;
        if (options.takenBefore) body.takenBefore = options.takenBefore;
        return body;
      };

      let res: Response | null = null;
      let lastErrText = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await immichFetch(
            '/api/search/metadata',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildBody()),
            },
            30000
          );
          if (res.ok) break;
          lastErrText = await res.text().catch(() => '');
          // Fallback to pageSize=250 if an Immich server rejects size=1000 on page 1
          if (res.status === 400 && pageSize > 250 && nextPageNum === 1 && attempt === 0) {
            logWarn('Immich', 'Server rejected page size=1000 (HTTP 400); falling back to size=250');
            pageSize = 250;
            continue;
          }
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch (err) {
          lastErrText = err instanceof Error ? err.message : 'Request timed out';
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      if (!res || !res.ok) {
        if (nextPageNum === 1) {
          throw new Error(
            `Immich /api/search/metadata failed${res ? ` (HTTP ${res.status})` : ''}${lastErrText ? `: ${lastErrText.slice(0, 140)}` : ''}`
          );
        }
        logWarn(
          'Immich',
          `Metadata pagination stopped early on page ${nextPageNum} after ${collected.length.toLocaleString()} photos (${lastErrText || 'HTTP error'})`
        );
        break;
      }

      const payload = (await res.json()) as {
        assets?: {
          total?: number;
          count?: number;
          items?: ImmichSearchItem[];
          nextPage?: string | number | null;
        };
      };

      const items = payload.assets?.items || [];
      const pageNewItems: ImmichSearchItem[] = [];
      for (const item of items) {
        if (collected.length >= effectiveMax) break;
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          collected.push(item);
          pageNewItems.push(item);
        }
      }

      // Guard against Immich nextPage loop bug (e.g. repeated identical page)
      if (pageNewItems.length === 0) {
        logWarn(
          'Immich',
          `Metadata pagination returned 0 new items on page ${nextPageNum}; stopping pagination loop`
        );
        break;
      }

      if (!demoPurged) {
        purgeDemoAssets();
        demoPurged = true;
      }
      persistMetadataItems(pageNewItems);
      savedToDbCount = collected.length;
      const currentDbTotal = getAssetCount();

      // Never treat Immich's per-page count (e.g. 250 or 1000) as total library size!
      const reportedTotal = typeof payload.assets?.total === 'number' ? payload.assets.total : 0;
      if (estimatedTotal === 0 && reportedTotal > pageSize) {
        estimatedTotal = rawMax > 0 ? Math.min(rawMax, reportedTotal) : reportedTotal;
      }
      if (estimatedTotal > 0 && collected.length > estimatedTotal) {
        estimatedTotal = 0;
      }

      const metaFraction =
        estimatedTotal > 0
          ? Math.min(1, collected.length / estimatedTotal)
          : Math.min(0.95, collected.length / (collected.length + 5000));
      const pct = 14 + metaFraction * 22;
      const elapsedSec = Math.max(0.5, (Date.now() - metaStartedAt) / 1000);
      const rate = collected.length / elapsedSec;
      const etaSec =
        estimatedTotal > collected.length && rate > 0
          ? Math.round((estimatedTotal - collected.length) / rate)
          : null;

      const nowMs = Date.now();
      if (nextPageNum === 1 || nextPageNum % 5 === 0 || nowMs - lastMetaLogAt >= 10_000) {
        lastMetaLogAt = nowMs;
        const etaStr = formatDurationShort(etaSec);
        logInfo(
          'Immich',
          `Phase 2/5 Metadata: page ${nextPageNum} · ${collected.length.toLocaleString()}${estimatedTotal > 0 ? ` / ${estimatedTotal.toLocaleString()}` : ''} saved to SQLite (${Math.round(pct)}% · ${Math.round(rate)}/s${etaStr ? ` · ETA ~${etaStr}` : ''})`
        );
      }

      setPullProgress({
        active: true,
        phase: 'metadata',
        percent: pct,
        label: 'Fetching & saving photo metadata',
        detail:
          estimatedTotal > 0
            ? `Page ${nextPageNum} · ${collected.length.toLocaleString()} / ${estimatedTotal.toLocaleString()} photos saved to SQLite`
            : `Page ${nextPageNum} · ${collected.length.toLocaleString()} photos saved to SQLite`,
        current: collected.length,
        total: estimatedTotal || collected.length,
        ingestedCount: savedToDbCount,
        dbAssetCount: currentDbTotal,
        etaSeconds: etaSec,
      });

      if (!payload.assets?.nextPage || items.length === 0) break;
      const parsedNext = Number(payload.assets.nextPage);
      nextPageNum =
        Number.isFinite(parsedNext) && parsedNext > nextPageNum ? parsedNext : nextPageNum + 1;
    }

    logInfo(
      'Immich',
      `Phase 2/5 Metadata complete: ${collected.length.toLocaleString()} photos persisted to SQLite in ${((Date.now() - metaStartedAt) / 1000).toFixed(1)}s`
    );

    // 3. Query CLIP Smart Search occasion prompts (36% -> 44%) and persist tags immediately
    const tagMap = new Map<string, Set<string>>();
    let smartTagsMatched = 0;
    let promptsDone = 0;

    if (!cancelRequestedFlag && collected.length > 0) {
      setPullProgress({
        active: true,
        phase: 'smart_search',
        percent: 36,
        label: 'Querying Immich ML Smart Search',
        detail: `0 / ${OCCASION_PROMPTS.length} CLIP visual concepts`,
        current: 0,
        total: OCCASION_PROMPTS.length,
        etaSeconds: null,
      });

      const SMART_CONCURRENCY = 6;
      for (let i = 0; i < OCCASION_PROMPTS.length; i += SMART_CONCURRENCY) {
        if (cancelRequestedFlag) break;
        const promptBatch = OCCASION_PROMPTS.slice(i, i + SMART_CONCURRENCY);
        await Promise.all(
          promptBatch.map(async (prompt) => {
            try {
              const smartRes = await immichFetch(
                '/api/search/smart',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    query: prompt,
                    type: 'IMAGE',
                    size: 500,
                  }),
                },
                25000
              );
              if (!smartRes.ok) return;
              const payload = (await smartRes.json()) as {
                assets?: { items?: Array<{ id: string }> };
              };
              for (const item of payload.assets?.items || []) {
                if (!seenIds.has(item.id)) continue;
                if (!tagMap.has(item.id)) tagMap.set(item.id, new Set());
                tagMap.get(item.id)!.add(prompt);
                smartTagsMatched++;
              }
            } catch {
              // Non-fatal if ML container is temporarily busy
            } finally {
              promptsDone++;
              const pct = 36 + (promptsDone / OCCASION_PROMPTS.length) * 8;
              setPullProgress({
                active: true,
                phase: 'smart_search',
                percent: pct,
                label: 'Querying Immich ML Smart Search',
                detail: `${promptsDone} / ${OCCASION_PROMPTS.length} CLIP visual concepts · ${smartTagsMatched.toLocaleString()} matches`,
                current: promptsDone,
                total: OCCASION_PROMPTS.length,
              });
            }
          })
        );
      }

      if (tagMap.size > 0) {
        db.transaction(() => {
          for (const [assetId, tags] of tagMap.entries()) {
            updateSmartTagsStmt.run(JSON.stringify(Array.from(tags)), assetId);
          }
        })();
      }
      logInfo(
        'Immich',
        `Phase 3/5 Smart Search: ${promptsDone}/${OCCASION_PROMPTS.length} CLIP prompts queried · ${smartTagsMatched.toLocaleString()} matches across ${tagMap.size.toLocaleString()} photos`
      );
    }

    // 4. Download thumbnails + extract CIELAB color features for uncached eligible photos (44% -> 92%)
    const existingRows = db
      .prepare('SELECT id, thumbnail_file, lab_l FROM assets')
      .all() as Array<{ id: string; thumbnail_file: string | null; lab_l: number | null }>;
    const existingById = new Map(existingRows.map((r) => [r.id, r]));

    const totalAssets = collected.length;
    let processedCount = 0;
    let cachedCount = 0;
    let skippedExcludedCount = 0;
    let consecutiveWebpToPreview = 0;
    let preferPreviewDirectly = false;
    let lastThumbLogAt = 0;
    let lastThumbLogCount = 0;
    const thumbStartedAt = Date.now();

    if (!cancelRequestedFlag && totalAssets > 0) {
      setPullProgress({
        active: true,
        phase: 'thumbnails',
        percent: 44,
        label: 'Downloading thumbnails & extracting CIELAB color',
        detail: `0 / ${totalAssets.toLocaleString()} photos processed`,
        current: 0,
        total: totalAssets,
        cachedCount: 0,
        ingestedCount: savedToDbCount,
        dbAssetCount: getAssetCount(),
        etaSeconds: null,
      });

      const CONCURRENCY = 20;
      for (let i = 0; i < collected.length; i += CONCURRENCY) {
        if (cancelRequestedFlag) break;
        const batch = collected.slice(i, i + CONCURRENCY);

        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const isAlbumed = alreadyAlbumedIds.has(item.id);
            const origPath = item.originalPath || `/immich/${item.originalFileName || item.id}`;
            const lowerPath = origPath.toLowerCase();
            const isPathExcluded = excludedKeywords.some((kw) => lowerPath.includes(kw));
            const isShot = looksLikeScreenshotItem(item);

            const existing = existingById.get(item.id);
            const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_');

            let thumbFile: string | null = existing?.thumbnail_file || null;
            if (thumbFile && !fs.existsSync(path.join(THUMBNAIL_DIR, thumbFile))) {
              thumbFile = null;
            }
            if (!thumbFile) {
              for (const ext of ['jpg', 'png', 'webp'] as const) {
                const candidate = `immich_${safeId}.${ext}`;
                if (fs.existsSync(path.join(THUMBNAIL_DIR, candidate))) {
                  thumbFile = candidate;
                  break;
                }
              }
            }

            let features: ReturnType<typeof extractColorFeaturesFromPixels> | null = null;
            const alreadyHasLab = existing?.lab_l !== null && existing?.lab_l !== undefined;
            let needsDbUpdate = false;

            if (isAlbumed || isPathExcluded || isShot) {
              skippedExcludedCount++;
            } else if (thumbFile && alreadyHasLab) {
              cachedCount++;
            } else {
              let imgBuf: Buffer | null = null;

              if (thumbFile) {
                cachedCount++;
                try {
                  imgBuf = fs.readFileSync(path.join(THUMBNAIL_DIR, thumbFile));
                } catch {
                  imgBuf = null;
                }
              } else {
                try {
                  const initialSize = preferPreviewDirectly ? 'preview' : 'thumbnail';
                  const thumbRes = await immichFetch(
                    `/api/assets/${encodeURIComponent(item.id)}/thumbnail?size=${initialSize}`,
                    { headers: { Accept: 'image/jpeg,image/png,image/webp,*/*' } },
                    15000
                  );
                  if (thumbRes.ok) {
                    let buf = Buffer.from(await thumbRes.arrayBuffer());
                    if (!preferPreviewDirectly && isWebpBuffer(buf)) {
                      try {
                        const previewRes = await immichFetch(
                          `/api/assets/${encodeURIComponent(item.id)}/thumbnail?size=preview`,
                          { headers: { Accept: 'image/jpeg,image/png,*/*' } },
                          15000
                        );
                        if (previewRes.ok) {
                          const previewBuf = Buffer.from(await previewRes.arrayBuffer());
                          if (!isWebpBuffer(previewBuf) && previewBuf.length > 0) {
                            buf = previewBuf;
                            consecutiveWebpToPreview++;
                            if (consecutiveWebpToPreview >= 3 && !preferPreviewDirectly) {
                              preferPreviewDirectly = true;
                              logInfo(
                                'Immich',
                                'Detected WebP thumbnails on server — switching directly to JPEG previews (saves 1 request/photo)'
                              );
                            }
                          }
                        }
                      } catch {
                        // Keep WebP
                      }
                    }
                    if (buf.length > 0) {
                      const ext = detectThumbExt(buf);
                      thumbFile = `immich_${safeId}.${ext}`;
                      fs.writeFileSync(path.join(THUMBNAIL_DIR, thumbFile), buf);
                      imgBuf = buf;
                      needsDbUpdate = true;
                    }
                  }
                } catch {
                  // Non-fatal thumbnail error
                }
              }

              if (imgBuf && !alreadyHasLab && thumbFile && !thumbFile.endsWith('.webp')) {
                try {
                  const mime = thumbFile.endsWith('.png') ? 'image/png' : 'image/jpeg';
                  const decoded = decodeImageBufferToRgba(imgBuf, mime);
                  features = extractColorFeaturesFromPixels(
                    decoded.data,
                    decoded.width,
                    decoded.height
                  );
                  needsDbUpdate = true;
                } catch {
                  // Non-fatal decode error; pipeline has neutral fallback
                }
              }
            }

            return { id: item.id, thumbFile, features, needsDbUpdate };
          })
        );

        const toWrite = batchResults.filter((r) => r.needsDbUpdate);
        if (toWrite.length > 0) {
          db.transaction(() => {
            for (const row of toWrite) {
              updateThumbLabStmt.run({
                id: row.id,
                thumbnail_file: row.thumbFile,
                lab_l: row.features ? row.features.avgLab.l : null,
                lab_a: row.features ? row.features.avgLab.a : null,
                lab_b: row.features ? row.features.avgLab.b : null,
                lab_chroma: row.features ? row.features.avgLab.chroma : null,
                lab_hist_json: row.features ? JSON.stringify(row.features.histogram) : null,
                palette_json: row.features ? JSON.stringify(row.features.palette) : null,
              });
            }
          })();
        }

        processedCount += batchResults.length;
        const pct = 44 + (processedCount / Math.max(1, totalAssets)) * 48;
        const thumbElapsed = Math.max(0.5, (Date.now() - thumbStartedAt) / 1000);
        const rate = processedCount / thumbElapsed;
        const etaSec =
          totalAssets > processedCount && rate > 0
            ? Math.round((totalAssets - processedCount) / rate)
            : null;
        const notes: string[] = [];
        if (cachedCount > 0) notes.push(`${cachedCount.toLocaleString()} cached`);
        if (skippedExcludedCount > 0) notes.push(`${skippedExcludedCount.toLocaleString()} skipped`);
        setPullProgress({
          active: true,
          phase: 'thumbnails',
          percent: pct,
          label: 'Downloading thumbnails & extracting CIELAB color',
          detail: `${processedCount.toLocaleString()} / ${totalAssets.toLocaleString()} photos${notes.length > 0 ? ` (${notes.join(' · ')})` : ''}`,
          current: processedCount,
          total: totalAssets,
          cachedCount,
          ingestedCount: savedToDbCount,
          etaSeconds: etaSec,
        });

        const nowThumbMs = Date.now();
        if (
          processedCount === totalAssets ||
          processedCount - lastThumbLogCount >= 500 ||
          nowThumbMs - lastThumbLogAt >= 10_000
        ) {
          lastThumbLogAt = nowThumbMs;
          lastThumbLogCount = processedCount;
          const etaStr = formatDurationShort(etaSec);
          logInfo(
            'Immich',
            `Phase 4/5 Thumbnails & CIELAB: ${processedCount.toLocaleString()} / ${totalAssets.toLocaleString()} (${Math.round(pct)}% · ${cachedCount.toLocaleString()} cached · ${skippedExcludedCount.toLocaleString()} skipped · ${rate.toFixed(1)}/s${etaStr ? ` · ETA ~${etaStr}` : ''})`
          );
        }
      }
      logInfo(
        'Immich',
        `Phase 4/5 Thumbnails & CIELAB complete: ${processedCount.toLocaleString()} / ${totalAssets.toLocaleString()} processed in ${((Date.now() - thumbStartedAt) / 1000).toFixed(1)}s`
      );
    }

    const totalInDb = getAssetCount();
    logInfo('Immich', `Phase 5/5 Clustering: running multi-signal pipeline on ${totalInDb.toLocaleString()} indexed photos...`);
    setPullProgress({
      active: true,
      phase: 'clustering',
      percent: 94,
      label: 'Building event & color-tone albums',
      detail: `Clustering ${totalInDb.toLocaleString()} indexed photos into album proposals...`,
      current: savedToDbCount,
      total: Math.max(totalAssets, totalInDb),
      cachedCount,
      ingestedCount: savedToDbCount,
      dbAssetCount: totalInDb,
      etaSeconds: null,
    });

    return {
      ingested: savedToDbCount,
      smartTagsMatched,
      cancelled: cancelRequestedFlag,
    };
  } catch (err) {
    failPullProgress(err instanceof Error ? err.message : 'Immich ingestion failed');
    throw err;
  }
}

/**
 * Creates a new Immich album via POST /api/albums.
 */
export async function createLiveImmichAlbum(
  albumName: string,
  description: string,
  assetIds: string[]
): Promise<{ id: string }> {
  const res = await immichFetch('/api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumName,
      description,
      assetIds,
    }),
  });
  if (!res.ok) {
    throw new Error(`Immich POST /albums failed with HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

/**
 * Idempotently appends new assets to an existing Immich album via PUT /api/albums/{id}/assets.
 */
export async function appendLiveImmichAlbumAssets(
  albumId: string,
  assetIds: string[]
): Promise<void> {
  const res = await immichFetch(`/api/albums/${encodeURIComponent(albumId)}/assets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: assetIds }),
  });
  if (!res.ok) {
    throw new Error(`Immich PUT /albums/${albumId}/assets failed with HTTP ${res.status}`);
  }
}
