import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  decodeImageBufferToRgba,
  extractColorFeaturesFromPixels,
} from './src/server/colorLab.ts';
import {
  getAllAssets,
  getAllClusters,
  getDb,
  getPipelineSummary,
  getSettings,
  getSyncHistory,
  parseYamlToSettings,
  saveSettings,
  settingsToYaml,
  THUMBNAIL_DIR,
} from './src/server/db.ts';
import { checkImmichStatus, ingestFromLiveImmich } from './src/server/immichClient.ts';
import {
  mergeClusters,
  runFullPipeline,
  splitClusterAtIndex,
  syncClusterIdempotent,
} from './src/server/pipeline.ts';
import {
  appendIncrementalTripPhotos,
  seedSampleLibraryIfEmpty,
} from './src/server/sampleLibrary.ts';

const PORT = Number(process.env.PORT || 3000);
const REPO_OWNER = 'NishantJh';
const REPO_NAME = 'immich_autoalbums';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const IMAGE_REF = `ghcr.io/${REPO_OWNER.toLowerCase()}/${REPO_NAME}:latest`;

function buildDockerComposeYaml(scanIntervalHours: number): string {
  return `services:
  immich-autoalbums:
    container_name: immich-autoalbums
    image: ${IMAGE_REF}
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/app/data
      - IMMICH_URL=\${IMMICH_URL}
      - IMMICH_API_KEY=\${IMMICH_API_KEY}
      - SCAN_INTERVAL_HOURS=${scanIntervalHours}
      - TZ=UTC
    volumes:
      - ./appdata:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
`;
}

function buildUnraidXml(scanIntervalHours: number): string {
  return `<?xml version="1.0"?>
<Container version="2">
  <Name>immich-autoalbums</Name>
  <Repository>${IMAGE_REF}</Repository>
  <Registry>${REPO_URL}/pkgs/container/${REPO_NAME}</Registry>
  <Network>bridge</Network>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <Support>${REPO_URL}/issues</Support>
  <Project>${REPO_URL}</Project>
  <Overview>Smart Event and CIELAB Color-Tone Album Organizer sidecar for Immich. Combines 5 km home-base spatiotemporal clustering, HDBSCAN-style local event detection, sliding-window CIELAB Earth Mover's Distance scene splitting, and human-in-the-loop flat-album review.</Overview>
  <Category>MediaApp:Photos Tools:</Category>
  <WebUI>http://[IP]:[PORT:3000]</WebUI>
  <TemplateURL>https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/unraid/immich-autoalbums.xml</TemplateURL>
  <Icon>https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/public/icon.svg</Icon>
  <ExtraParams>--restart=unless-stopped</ExtraParams>
  <Requires>An active Immich server and an Immich API key created under Account Settings -&gt; API Keys.</Requires>
  <Config Name="Web UI Port" Target="3000" Default="3000" Mode="tcp" Description="Port for the ChromaCluster review dashboard." Type="Port" Display="always" Required="true" Mask="false">3000</Config>
  <Config Name="AppData Directory" Target="/app/data" Default="/mnt/user/appdata/immich-autoalbums" Mode="rw" Description="Persistent storage for the SQLite CIELAB feature cache, thumbnails, and sync ledger." Type="Path" Display="always" Required="true" Mask="false">/mnt/user/appdata/immich-autoalbums</Config>
  <Config Name="Immich Server URL" Target="IMMICH_URL" Default="http://192.168.1.50:2283" Mode="" Description="Base URL of your Immich server (e.g. http://immich:2283 or https://photos.yourdomain.com)." Type="Variable" Display="always" Required="true" Mask="false"/>
  <Config Name="Immich API Key" Target="IMMICH_API_KEY" Default="" Mode="" Description="Immich API key with asset read, smart search, and album write permissions." Type="Variable" Display="always" Required="true" Mask="true"/>
  <Config Name="Scan Interval (Hours)" Target="SCAN_INTERVAL_HOURS" Default="${scanIntervalHours}" Mode="" Description="Background incremental scan interval in hours." Type="Variable" Display="always" Required="false" Mask="false">${scanIntervalHours}</Config>
  <Config Name="Data Directory" Target="DATA_DIR" Default="/app/data" Mode="" Description="Internal container path for SQLite storage." Type="Variable" Display="advanced" Required="true" Mask="false">/app/data</Config>
  <Config Name="PUID" Target="PUID" Default="99" Mode="" Description="Unraid user ID (nobody = 99)." Type="Variable" Display="advanced" Required="false" Mask="false">99</Config>
  <Config Name="PGID" Target="PGID" Default="100" Mode="" Description="Unraid group ID (users = 100)." Type="Variable" Display="advanced" Required="false" Mask="false">100</Config>
</Container>
`;
}

function buildDockerfileText(): string {
  return `FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save tsx
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/public ./public
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server.ts"]
`;
}

function buildGithubWorkflowYaml(): string {
  return `name: Build and Publish Unraid Container Image

on:
  push:
    branches: ["main"]
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${REPO_OWNER.toLowerCase()}/${REPO_NAME}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=semver,pattern={{version}}

      - name: Build and push multi-arch image
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;
}

async function startServer() {
  // Initialize SQLite, seed realistic sample library on first launch, and run initial pipeline
  getDb();
  const seeded = seedSampleLibraryIfEmpty(false);
  if (seeded > 0 || !getPipelineSummary()) {
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

  // Immich server status (read-only; credentials never leave the server)
  app.get('/api/immich/status', async (_req, res) => {
    const status = await checkImmichStatus();
    res.json(status);
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
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
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

  // Simulate new trip photos arriving in Immich (tests incremental SQLite cache & idempotent append)
  app.post('/api/library/simulate-new-photos', (_req, res) => {
    const added = appendIncrementalTripPhotos();
    const run = runFullPipeline();
    res.json({ added, ...run, assets: getAllAssets() });
  });

  // Reset sample library cleanly
  app.post('/api/library/reset-sample', (_req, res) => {
    const count = seedSampleLibraryIfEmpty(true);
    const run = runFullPipeline();
    res.json({ count, ...run, assets: getAllAssets(), syncHistory: getSyncHistory() });
  });

  // Run 4-Stage Clustering & CIELAB Scene-Split Pipeline
  app.post('/api/pipeline/run', (_req, res) => {
    const run = runFullPipeline();
    res.json({ ...run, assets: getAllAssets() });
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

  // Settings & config.yaml endpoints
  app.get('/api/settings', (_req, res) => {
    const settings = getSettings();
    res.json({ settings, yaml: settingsToYaml(settings) });
  });

  app.put('/api/settings', (req, res) => {
    try {
      const { settings: partial, yaml: rawYaml, rerun } = req.body as {
        settings?: Record<string, unknown>;
        yaml?: string;
        rerun?: boolean;
      };
      const updates =
        typeof rawYaml === 'string' && rawYaml.trim().length > 0
          ? parseYamlToSettings(rawYaml)
          : (partial || {});
      const saved = saveSettings(updates);
      const pipeline = rerun ? runFullPipeline() : null;
      res.json({
        settings: saved,
        yaml: settingsToYaml(saved),
        ...(pipeline ? { summary: pipeline.summary, clusters: pipeline.clusters } : {}),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid settings' });
    }
  });

  // Deployment bundle (Unraid Community Apps XML, docker-compose.yml, Dockerfile, GitHub Actions, config.yaml)
  app.get('/api/deploy/bundle', (_req, res) => {
    const settings = getSettings();
    res.json({
      repoUrl: REPO_URL,
      imageRef: IMAGE_REF,
      files: {
        unraidXml: buildUnraidXml(settings.scanIntervalHours),
        dockerCompose: buildDockerComposeYaml(settings.scanIntervalHours),
        dockerfile: buildDockerfileText(),
        githubWorkflow: buildGithubWorkflowYaml(),
        configYaml: settingsToYaml(settings),
      },
    });
  });

  // Vite dev middleware vs production dist static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
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
