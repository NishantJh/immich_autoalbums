import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ImmichStatus } from '../shared/types.ts';
import { DATA_DIR, getDb, THUMBNAIL_DIR } from './db.ts';

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
  return {
    baseUrl: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ''),
    hostLabel: parsed.host,
  };
}

function maskKey(apiKey: string): string {
  const clean = apiKey.trim();
  if (clean.length <= 4) return '••••';
  return `••••••••${clean.slice(-4)}`;
}

function getSavedImmichConfig(): { baseUrl: string; apiKey: string; hostLabel: string } | null {
  const row = getDb()
    .prepare('SELECT value_json FROM app_state WHERE key = ?')
    .get('immich_connection') as { value_json: string } | undefined;
  if (!row) return null;

  try {
    const stored = JSON.parse(row.value_json) as StoredImmichConfig;
    const apiKey = decryptSecret(stored);
    if (!apiKey) return null;
    const { baseUrl, hostLabel } = validateImmichUrl(stored.baseUrl);
    return { baseUrl, apiKey, hostLabel };
  } catch {
    return null;
  }
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

  const rawUrl = (process.env.IMMICH_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.IMMICH_API_KEY || '').trim();
  if (!rawUrl || !apiKey) return null;

  try {
    const { baseUrl, hostLabel } = validateImmichUrl(rawUrl);
    return { baseUrl, apiKey, hostLabel, source: 'env' };
  } catch {
    return null;
  }
}

export async function probeImmichConnection(
  baseUrl: string,
  apiKey: string
): Promise<{ reachable: boolean; serverVersion: string | null; lastError: string | null }> {
  try {
    const res = await fetch(`${baseUrl}/api/server/version`, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        reachable: false,
        serverVersion: null,
        lastError:
          res.status === 401 || res.status === 403
            ? 'Immich rejected the API key (HTTP 401/403).'
            : `HTTP ${res.status} from Immich server`,
      };
    }
    const ver = (await res.json()) as { major?: number; minor?: number; patch?: number };
    const versionStr =
      typeof ver.major === 'number' ? `v${ver.major}.${ver.minor ?? 0}.${ver.patch ?? 0}` : 'connected';
    return { reachable: true, serverVersion: versionStr, lastError: null };
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
  const apiKey = (rawApiKey || '').trim() || existing?.apiKey || '';
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

  return checkImmichStatus();
}

export async function clearSavedImmichConnection(): Promise<ImmichStatus> {
  getDb().prepare('DELETE FROM app_state WHERE key = ?').run('immich_connection');
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
  const targetUrl = `${cfg.baseUrl}${normalizedPath}`;

  const headers = new Headers(init.headers || {});
  headers.set('x-api-key', cfg.apiKey);
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
    for (const album of albums.slice(0, 40)) {
      const detailRes = await immichFetch(`/api/albums/${encodeURIComponent(album.id)}`);
      if (detailRes.ok) {
        const detail = (await detailRes.json()) as { assets?: Array<{ id: string }> };
        for (const a of detail.assets || []) {
          alreadyAlbumedIds.add(a.id);
        }
      }
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
    if (!res.ok) break;
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
  for (const prompt of OCCASION_PROMPTS) {
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
      if (!smartRes.ok) continue;
      const payload = (await smartRes.json()) as { assets?: { items?: Array<{ id: string }> } };
      for (const item of payload.assets?.items || []) {
        if (!tagMap.has(item.id)) tagMap.set(item.id, new Set());
        tagMap.get(item.id)!.add(prompt);
        smartTagsMatched++;
      }
    } catch {
      // Non-fatal if ML container is temporarily busy
    }
  }

  // 4. Cache thumbnails locally and upsert metadata into SQLite
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  const db = getDb();
  const now = new Date().toISOString();

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
      smart_tags_json = excluded.smart_tags_json
  `);

  for (const item of collected) {
    const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const thumbFile = `immich_${safeId}.jpg`;
    const thumbFull = path.join(THUMBNAIL_DIR, thumbFile);

    if (!fs.existsSync(thumbFull)) {
      try {
        const thumbRes = await immichFetch(
          `/api/assets/${encodeURIComponent(item.id)}/thumbnail?size=thumbnail`,
          { headers: { Accept: 'image/jpeg,image/webp,*/*' } }
        );
        if (thumbRes.ok) {
          const buf = Buffer.from(await thumbRes.arrayBuffer());
          fs.writeFileSync(thumbFull, buf);
        }
      } catch {
        // Skip thumbnail fetch error; handled cleanly in pipeline
      }
    }

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
      thumbnail_file: fs.existsSync(thumbFull) ? thumbFile : null,
      created_at: now,
    });
  }

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
