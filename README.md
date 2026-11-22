# ChromaCluster — Immich Smart Event & Color-Tone Album Organizer

Repository: [`https://github.com/NishantJh/immich_autoalbums`](https://github.com/NishantJh/immich_autoalbums)

An external sidecar companion web app for self-hosted [Immich](https://immich.app) photo servers that combines **spatiotemporal event clustering** (5 km home-base inference, multi-day trips, and home-city local event detection) with **CIELAB perceptual color-tone scene splitting** (K-Means 5-color palettes + sliding-window Earth Mover's Distance) and **human-in-the-loop flat-album review**.

## Features

- **4-Stage Clustering & Color-Tone Pipeline**
  1. **Pre-Filter & SQLite Feature Cache**: Filters trashed, archived, already-albumed, excluded folder paths (`WhatsApp`, `Downloads`, `Screenshots`), and suspected screenshots (missing camera EXIF + screen aspect ratio). Caches CIELAB histograms and 5-color palettes in SQLite (`organizer.db`) for fast incremental runs.
  2. **Spatiotemporal Grouping**: Automatically infers your 5 km geohash home base, merges multi-day trips (`< 36 hrs` gap outside home radius), and discovers local home-city events via density + fine GPS + recurring non-household faces.
  3. **CIELAB Color-Tone Scene Split**: Computes sliding-window (5-photo) Earth Mover's Distance across perceptual `L*a*b*` channels. Sharp lightness/temperature shifts paired with a `>= 30 min` gap split multi-scene events into visually cohesive chapters (*Golden Hour*, *Lush Nature*, *Vibrant Night*, *Monochrome*, *Warm Indoor*, *Coastal Daylight*).
  4. **Semantic Flat-Album Naming**: Works around Immich's flat-album list using Structured Prefix Naming (`2026-11 • Goa Trip (All)`, `2026-11 • Goa Trip — Beach & Golden Hour`) and zero-duplication overlapping multi-album assignment.
- **Human-in-the-Loop Review Mode**: Inline album renaming, multi-cluster merge, manual photo-boundary split drawer, and idempotent syncing (`POST /api/albums` on first sync, `PUT /api/albums/{id}/assets` when new trip photos arrive).
- **Unraid Community Applications & Docker Ready**: Includes `Dockerfile`, `docker-compose.yml`, `unraid/immich-autoalbums.xml`, and `.github/workflows/docker-publish.yml`.

## Quick Start (Docker Compose)

```bash
git clone https://github.com/NishantJh/immich_autoalbums.git
cd immich_autoalbums
cp .env.example .env
# Edit .env with IMMICH_URL and IMMICH_API_KEY
docker compose up -d
```

Open `http://localhost:3000`.

## Unraid Community Applications Release

1. Push this repository to `https://github.com/NishantJh/immich_autoalbums` (`main` branch).
2. The GitHub Actions workflow (`.github/workflows/docker-publish.yml`) builds and pushes `ghcr.io/nishantjh/immich_autoalbums:latest` (`linux/amd64` and `linux/arm64`).
3. In GitHub Packages, set the `immich_autoalbums` container package visibility to **Public**.
4. Use `unraid/immich-autoalbums.xml` as your Unraid Community Applications template (maps `/mnt/user/appdata/immich-autoalbums` to `/app/data`, exposes port `3000`, and masks `IMMICH_API_KEY`).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `IMMICH_URL` | For live sync | Base URL of your Immich server (e.g. `http://192.168.1.50:2283`) |
| `IMMICH_API_KEY` | For live sync | Immich API key (kept strictly server-side; never exposed to browser) |
| `DATA_DIR` | Optional | SQLite & thumbnail cache directory (defaults to `./data`, `/app/data` in Docker) |
| `PORT` | Optional | HTTP server port (defaults to `3000`) |
