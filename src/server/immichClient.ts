import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ImmichStatus } from '../shared/types.ts';
import { DATA_DIR, getDb, purgeDemoAssets, THUMBNAIL_DIR } from './db.ts';

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

async function immichFetch(apiPath: string, init: RequestInit = {}): Promise<Response> {
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
    signal: AbortSignal.timeout(10000),
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
  exifInfo?: {
    city?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    make?: string | null;
    model?: string | null;
    exifImageWidth?: number | null;
    exifImageHeight?: number | null;
  };
  people?: Array<{ id: string }>;
}

const OCCASION_PROMPTS = [
  'wedding ceremony',
  'birthday cake',
  'beach',
  'hiking',
  'dinner',
  'concert',
  'architecture',
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
export async function ingestFromLiveImmich(maxPages = 5): Promise<{
  ingested: number;
  smartTagsMatched: number;
}> {
  const status = await checkImmichStatus();
  if (!status.configured || !status.reachable) {
    throw new Error(status.lastError || 'Live Immich server is not configured or unreachable.');
  }

  // 1. Collect already-albumed asset IDs so curated albums remain untouched
  const alreadyAlbumedIds = new Set<string>();
  const albumsRes = await immichFetch('/api/albums');
  if (albumsRes.ok) {
    const albums = (await albumsRes.json()) as Array<{ id: string }>;
    for (let i = 0; i < Math.min(albums.length, 40); i += 6) {
      const batch = albums.slice(i, i + 6);
      await Promise.all(
        batch.map(async (album) => {
          try {
            const detailRes = await immichFetch(`/api/albums/${encodeURIComponent(album.id)}`);
            if (detailRes.ok) {
              const detail = (await detailRes.json()) as { assets?: Array<{ id: string }> };
              for (const a of detail.assets || []) {
                alreadyAlbumedIds.add(a.id);
              }
            }
          } catch {
            // Non-fatal
          }
        })
      );
    }
  }

  // 2. Paginate POST /api/search/metadata excluding archived & trashed
  const collected: ImmichSearchItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await immichFetch('/api/search/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isArchived: false,
        isTrashed: false,
        type: 'IMAGE',
        withExif: true,
        withPeople: true,
        page,
        size: 100,
      }),
    });
    if (!res.ok) {
      if (page === 1) {
        const errText = await res.text().catch(() => '');
        throw new Error(
          `Immich /api/search/metadata failed (HTTP ${res.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`
        );
      }
      break;
    }
    const payload = (await res.json()) as {
      assets?: { items?: ImmichSearchItem[]; nextPage?: string | null };
    };
    const items = payload.assets?.items || [];
    collected.push(...items);
    if (!payload.assets?.nextPage || items.length === 0) break;
  }

  // 3. Query CLIP Smart Search occasion prompts and intersect asset IDs
  const tagMap = new Map<string, Set<string>>();
  let smartTagsMatched = 0;
  await Promise.all(
    OCCASION_PROMPTS.map(async (prompt) => {
      try {
        const smartRes = await immichFetch('/api/search/smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: prompt,
            type: 'IMAGE',
            size: 100,
          }),
        });
        if (!smartRes.ok) return;
        const payload = (await smartRes.json()) as { assets?: { items?: Array<{ id: string }> } };
        for (const item of payload.assets?.items || []) {
          if (!tagMap.has(item.id)) tagMap.set(item.id, new Set());
          tagMap.get(item.id)!.add(prompt);
          smartTagsMatched++;
        }
      } catch {
        // Non-fatal if ML container is temporarily busy
      }
    })
  );

  // 4. Download thumbnails concurrently (preferring JPEG/PNG for CIELAB decoding) and upsert SQLite
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  const db = getDb();
  const now = new Date().toISOString();

  if (collected.length > 0) {
    purgeDemoAssets();
  }

  const thumbFileById = new Map<string, string>();
  const CONCURRENCY = 6;
  for (let i = 0; i < collected.length; i += CONCURRENCY) {
    const batch = collected.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (item) => {
        const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const existingExts: Array<'jpg' | 'png' | 'webp'> = ['jpg', 'png', 'webp'];
        for (const ext of existingExts) {
          const candidate = `immich_${safeId}.${ext}`;
          if (fs.existsSync(path.join(THUMBNAIL_DIR, candidate))) {
            thumbFileById.set(item.id, candidate);
            return;
          }
        }

        try {
          let thumbRes = await immichFetch(
            `/api/assets/${encodeURIComponent(item.id)}/thumbnail?size=thumbnail`,
            { headers: { Accept: 'image/jpeg,image/png,image/webp,*/*' } }
          );
          if (!thumbRes.ok) return;
          let buf = Buffer.from(await thumbRes.arrayBuffer());

          // If Immich returned WebP for thumbnail, try size=preview which Immich often serves as JPEG
          if (isWebpBuffer(buf)) {
            try {
              const previewRes = await immichFetch(
                `/api/assets/${encodeURIComponent(item.id)}/thumbnail?size=preview`,
                { headers: { Accept: 'image/jpeg,image/png,*/*' } }
              );
              if (previewRes.ok) {
                const previewBuf = Buffer.from(await previewRes.arrayBuffer());
                if (!isWebpBuffer(previewBuf) && previewBuf.length > 0) {
                  buf = previewBuf;
                }
              }
            } catch {
              // Keep original WebP buffer
            }
          }

          if (buf.length > 0) {
            const ext = detectThumbExt(buf);
            const fileName = `immich_${safeId}.${ext}`;
            fs.writeFileSync(path.join(THUMBNAIL_DIR, fileName), buf);
            thumbFileById.set(item.id, fileName);
          }
        } catch {
          // Non-fatal thumbnail error
        }
      })
    );
  }

  const upsert = db.prepare(`
    INSERT INTO assets (
      id, source, file_name, original_path, local_date_time,
      city, country, latitude, longitude, exif_make, exif_model,
      width, height, is_archived, is_trashed, is_already_albumed,
      is_screenshot, excluded_reason, people_ids_json, smart_tags_json,
      thumbnail_file, created_at
    ) VALUES (
      @id, 'immich', @file_name, @original_path, @local_date_time,
      @city, @country, @latitude, @longitude, @exif_make, @exif_model,
      @width, @height, @is_archived, @is_trashed, @is_already_albumed,
      0, NULL, @people_ids_json, @smart_tags_json,
      @thumbnail_file, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      is_archived = excluded.is_archived,
      is_trashed = excluded.is_trashed,
      is_already_albumed = excluded.is_already_albumed,
      smart_tags_json = excluded.smart_tags_json,
      thumbnail_file = COALESCE(excluded.thumbnail_file, assets.thumbnail_file)
  `);

  db.transaction(() => {
    for (const item of collected) {
      const exif = item.exifInfo || {};
      upsert.run({
        id: item.id,
        file_name: item.originalFileName || `${item.id}.jpg`,
        original_path: item.originalPath || `/immich/${item.originalFileName || item.id}`,
        local_date_time: item.localDateTime || item.fileCreatedAt || now,
        city: exif.city || null,
        country: exif.country || null,
        latitude: typeof exif.latitude === 'number' ? exif.latitude : null,
        longitude: typeof exif.longitude === 'number' ? exif.longitude : null,
        exif_make: exif.make || null,
        exif_model: exif.model || null,
        width: exif.exifImageWidth || 1600,
        height: exif.exifImageHeight || 1200,
        is_archived: item.isArchived ? 1 : 0,
        is_trashed: item.isTrashed ? 1 : 0,
        is_already_albumed: alreadyAlbumedIds.has(item.id) ? 1 : 0,
        people_ids_json: JSON.stringify((item.people || []).map((p) => p.id)),
        smart_tags_json: JSON.stringify(Array.from(tagMap.get(item.id) || [])),
        thumbnail_file: thumbFileById.get(item.id) || null,
        created_at: now,
      });
    }
  })();

  return { ingested: collected.length, smartTagsMatched };
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
