import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  decodeImageBufferToRgba,
  extractColorFeaturesFromPixels,
} from './src/server/colorLab.ts';
import {
  clearLocalLibraryCache,
  getAllAssets,
  getAllClusters,
  getDb,
  getPipelineSummary,
  getSettings,
  getSyncHistory,
  purgeDemoAssets,
  saveSettings,
  THUMBNAIL_DIR,
} from './src/server/db.ts';
import {
  checkImmichStatus,
  clearSavedImmichConnection,
  getActiveImmichKey,
  ingestFromLiveImmich,
  normalizeApiKey,
  probeImmichConnection,
  saveImmichConnection,
  validateImmichUrl,
} from './src/server/immichClient.ts';
import {
  mergeClusters,
  runFullPipeline,
  splitClusterAtIndex,
  syncClusterIdempotent,
} from './src/server/pipeline.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  // Initialize SQLite, purge any legacy demo assets/thumbnails, and refresh summary if needed
  getDb();
  const purged = purgeDemoAssets();
  if (purged > 0 || !getPipelineSummary()) {
    runFullPipeline();
  }

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Health endpoint for Docker / Unraid healthchecks
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'immich-autoalbums', timestamp: new Date().toISOString() });
  });

  // Bootstrap entire workspace state
  app.get('/api/bootstrap', async (_req, res) => {
    try {
      const immichStatus = await checkImmichStatus();
      res.json({
        immichStatus,
        settings: getSettings(),
        clusters: getAllClusters(true),
        assets: getAllAssets(),
        pipelineSummary: getPipelineSummary(),
        syncHistory: getSyncHistory(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load workspace state',
      });
    }
  });

  // Immich server status (read-only; raw key never leaves the server)
  app.get('/api/immich/status', async (_req, res) => {
    const status = await checkImmichStatus();
    res.json(status);
  });

  // Test or save Immich Server URL & API Key (encrypted at rest on server; never echoed back)
  app.post('/api/immich/config', async (req, res) => {
    try {
      const { url, apiKey, testOnly } = req.body as {
        url?: string;
        apiKey?: string;
        testOnly?: boolean;
      };
      const { baseUrl } = validateImmichUrl(String(url || ''));

      if (testOnly) {
        const cleanKey = normalizeApiKey(String(apiKey || '')) || getActiveImmichKey() || '';
        if (!cleanKey) {
          res.status(400).json({ error: 'Enter an Immich API key to test.' });
          return;
        }
        const probe = await probeImmichConnection(baseUrl, cleanKey);
        res.json({ probe });
        return;
      }

      const status = await saveImmichConnection(baseUrl, apiKey);
      res.json({ status });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to configure Immich connection',
      });
    }
  });

  // Clear saved Immich credentials (falls back to env vars if configured)
  app.delete('/api/immich/config', async (_req, res) => {
    const status = await clearSavedImmichConnection();
    res.json({ status });
  });

  // Pull assets from a configured live Immich server & run clustering
  app.post('/api/immich/ingest', async (_req, res) => {
    try {
      const result = await ingestFromLiveImmich(5);
      const run = runFullPipeline();
      res.json({ ...result, ...run });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Immich ingestion failed',
      });
    }
  });

  // Serve cached thumbnails with strict path confinement inside THUMBNAIL_DIR
  app.get('/api/assets/:id/thumbnail', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 160) {
      res.status(400).json({ error: 'Invalid asset ID' });
      return;
    }

    const row = getDb()
      .prepare('SELECT thumbnail_file FROM assets WHERE id = ?')
      .get(id) as { thumbnail_file: string | null } | undefined;

    if (!row?.thumbnail_file) {
      res.status(404).json({ error: 'Thumbnail not found' });
      return;
    }

    const safeBase = path.basename(row.thumbnail_file);
    const resolved = path.resolve(THUMBNAIL_DIR, safeBase);
    if (!resolved.startsWith(THUMBNAIL_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Thumbnail file missing' });
      return;
    }

    const ext = path.extname(safeBase).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(resolved);
  });

  // Upload user's real local photos (base64 JPEG/PNG thumbnail + EXIF metadata)
  app.post('/api/assets/upload', (req, res) => {
    try {
      const { files } = req.body as {
        files?: Array<{
          fileName: string;
          originalPath?: string;
          localDateTime: string;
          city?: string | null;
          country?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          exifMake?: string | null;
          exifModel?: string | null;
          width?: number;
          height?: number;
          smartTags?: string[];
          thumbnailDataUrl: string;
        }>;
      };

      if (!Array.isArray(files) || files.length === 0 || files.length > 60) {
        res.status(400).json({ error: 'Provide between 1 and 60 photos per batch.' });
        return;
      }

      fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
      const db = getDb();
      const now = new Date().toISOString();
      let inserted = 0;

      const stmt = db.prepare(`
        INSERT INTO assets (
          id, source, file_name, original_path, local_date_time,
          city, country, latitude, longitude, exif_make, exif_model,
          width, height, is_archived, is_trashed, is_already_albumed,
          is_screenshot, excluded_reason, people_ids_json, smart_tags_json,
          thumbnail_file, lab_l, lab_a, lab_b, lab_chroma, lab_hist_json, palette_json, created_at
        ) VALUES (
          @id, 'upload', @file_name, @original_path, @local_date_time,
          @city, @country, @latitude, @longitude, @exif_make, @exif_model,
          @width, @height, 0, 0, 0,
          0, NULL, '["person_self"]', @smart_tags_json,
          @thumbnail_file, @lab_l, @lab_a, @lab_b, @lab_chroma, @lab_hist_json, @palette_json, @created_at
        )
      `);

      for (const f of files) {
        if (typeof f.thumbnailDataUrl !== 'string') continue;
        const match = f.thumbnailDataUrl.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) continue;

        const mime = match[1];
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length > 4 * 1024 * 1024) continue;

        const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ext = mime === 'image/png' ? 'png' : 'jpg';
        const thumbFile = `${id}.${ext}`;
        const resolved = path.resolve(THUMBNAIL_DIR, thumbFile);
        if (!resolved.startsWith(THUMBNAIL_DIR + path.sep)) continue;

        fs.writeFileSync(resolved, buf);
        const decoded = decodeImageBufferToRgba(buf, mime);
        const features = extractColorFeaturesFromPixels(
          decoded.data,
          decoded.width,
          decoded.height
        );

        const safeName = String(f.fileName || `${id}.${ext}`).slice(0, 120);
        stmt.run({
          id,
          file_name: safeName,
          original_path: String(f.originalPath || `/uploads/${safeName}`).slice(0, 240),
          local_date_time: f.localDateTime || now,
          city: f.city ? String(f.city).slice(0, 80) : null,
          country: f.country ? String(f.country).slice(0, 80) : null,
          latitude: typeof f.latitude === 'number' && Number.isFinite(f.latitude) ? f.latitude : null,
          longitude: typeof f.longitude === 'number' && Number.isFinite(f.longitude) ? f.longitude : null,
          exif_make: f.exifMake ? String(f.exifMake).slice(0, 60) : null,
          exif_model: f.exifModel ? String(f.exifModel).slice(0, 60) : null,
          width: Math.max(1, Math.round(Number(f.width) || decoded.width)),
          height: Math.max(1, Math.round(Number(f.height) || decoded.height)),
          smart_tags_json: JSON.stringify(Array.isArray(f.smartTags) ? f.smartTags.slice(0, 8) : []),
          thumbnail_file: thumbFile,
          lab_l: features.avgLab.l,
          lab_a: features.avgLab.a,
          lab_b: features.avgLab.b,
          lab_chroma: features.avgLab.chroma,
          lab_hist_json: JSON.stringify(features.histogram),
          palette_json: JSON.stringify(features.palette),
          created_at: now,
        });
        inserted++;
      }

      const run = runFullPipeline();
      res.json({ inserted, ...run, assets: getAllAssets() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to ingest uploaded photos',
      });
    }
  });

  // Clear all locally cached assets, clusters, and thumbnails (never modifies Immich)
  app.post('/api/library/clear', (_req, res) => {
    const cleared = clearLocalLibraryCache();
    const run = runFullPipeline();
    res.json({ cleared, ...run, assets: getAllAssets(), syncHistory: getSyncHistory() });
  });

  // Run 4-Stage Clustering & CIELAB Scene-Split Pipeline (pulls from live Immich when connected)
  app.post('/api/pipeline/run', async (_req, res) => {
    try {
      const immichStatus = await checkImmichStatus();
      if (immichStatus.configured && immichStatus.reachable) {
        const ingest = await ingestFromLiveImmich(5);
        const run = runFullPipeline();
        res.json({
          ...run,
          assets: getAllAssets(),
          immichStatus,
          ingested: ingest.ingested,
          mode: 'live_immich',
        });
        return;
      }

      const run = runFullPipeline();
      res.json({
        ...run,
        assets: getAllAssets(),
        immichStatus,
        ingested: 0,
        mode: immichStatus.configured ? 'local_fallback' : 'local_cache',
        immichWarning: immichStatus.configured
          ? immichStatus.lastError || 'Configured Immich server is unreachable'
          : undefined,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Scan pipeline failed',
      });
    }
  });

  // Clear SQLite LAB feature cache so next run demonstrates fresh pixel extraction
  app.post('/api/pipeline/clear-cache', (_req, res) => {
    getDb()
      .prepare(
        "UPDATE assets SET lab_l = NULL, lab_a = NULL, lab_b = NULL, lab_chroma = NULL, lab_hist_json = NULL, palette_json = '[]'"
      )
      .run();
    res.json({ cleared: true });
  });

  // Update cluster title or status (rename, approve, discard, restore)
  app.patch('/api/clusters/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    const { title, status } = req.body as {
      title?: string;
      status?: 'pending' | 'approved' | 'discarded';
    };

    const existing = getAllClusters(false).find((c) => c.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Cluster not found' });
      return;
    }

    const nextTitle =
      typeof title === 'string' && title.trim().length > 0
        ? title.trim().slice(0, 140)
        : existing.title;
    const allowedStatuses = new Set(['pending', 'approved', 'discarded']);
    const nextStatus =
      status && allowedStatuses.has(status) ? status : existing.status;

    getDb()
      .prepare('UPDATE clusters SET title = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, nextStatus, new Date().toISOString(), id);

    res.json({ clusters: getAllClusters(true) });
  });

  // Merge selected clusters
  app.post('/api/clusters/merge', (req, res) => {
    try {
      const { clusterIds, title } = req.body as { clusterIds?: string[]; title?: string };
      if (!Array.isArray(clusterIds) || clusterIds.length < 2) {
        res.status(400).json({ error: 'Select at least 2 clusters to merge.' });
        return;
      }
      const merged = mergeClusters(clusterIds.map(String), title);
      res.json({ merged, clusters: getAllClusters(true) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Merge failed' });
    }
  });

  // Manually split a cluster at a chosen photo boundary
  app.post('/api/clusters/:id/split', (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const splitIndex = Number(req.body?.splitIndex);
      if (!Number.isInteger(splitIndex)) {
        res.status(400).json({ error: 'Provide a valid integer splitIndex.' });
        return;
      }
      const created = splitClusterAtIndex(id, splitIndex);
      res.json({ created, clusters: getAllClusters(true) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Split failed' });
    }
  });

  // Idempotent Sync single cluster or all approved clusters
  app.post('/api/clusters/:id/sync', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const result = await syncClusterIdempotent(id);
      res.json({
        ...result,
        clusters: getAllClusters(true),
        syncHistory: getSyncHistory(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  app.post('/api/clusters/sync-approved', async (_req, res) => {
    try {
      const targets = getAllClusters(false).filter((c) => c.status === 'approved');
      const results = [];
      for (const t of targets) {
        results.push(await syncClusterIdempotent(t.id));
      }
      res.json({
        syncedCount: results.length,
        clusters: getAllClusters(true),
        syncHistory: getSyncHistory(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Batch sync failed' });
    }
  });

  // Settings endpoints (persisted in SQLite)
  app.get('/api/settings', (_req, res) => {
    const settings = getSettings();
    res.json({ settings });
  });

  app.put('/api/settings', (req, res) => {
    try {
      const { settings: partial, rerun } = req.body as {
        settings?: Record<string, unknown>;
        rerun?: boolean;
      };
      const saved = saveSettings(partial || {});
      const pipeline = rerun ? runFullPipeline() : null;
      res.json({
        settings: saved,
        ...(pipeline ? { summary: pipeline.summary, clusters: pipeline.clusters } : {}),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid settings' });
    }
  });

  // Vite dev middleware vs production dist static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChromaCluster server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ChromaCluster server:', err);
  process.exit(1);
});
