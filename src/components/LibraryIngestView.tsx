import exifr from 'exifr';
import {
  AlertCircle,
  CheckCircle2,
  CloudDownload,
  Database,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  PlugZap,
  Save,
  Search,
  Server,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssetRecord,
  ImmichStatus,
  OrganizerSettings,
  PullProgressState,
} from '../shared/types.ts';
import { PaletteBar } from './PaletteBar.tsx';
import { ThumbnailImage } from './ThumbnailImage.tsx';

interface LibraryIngestViewProps {
  assets: AssetRecord[];
  immichStatus: ImmichStatus;
  settings: OrganizerSettings;
  pullProgress: PullProgressState | null;
  busyAction: string | null;
  onUploadPhotos: (
    files: Array<{
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
      smartTags: string[];
      thumbnailDataUrl: string;
    }>
  ) => Promise<void>;
  onSaveImmichConfig: (url: string, apiKey: string) => Promise<void>;
  onTestImmichConfig: (url: string, apiKey: string) => Promise<{
    reachable: boolean;
    serverVersion: string | null;
    lastError: string | null;
  }>;
  onDisconnectImmich: () => Promise<void>;
  onIngestImmich: (options?: {
    maxAssets?: number;
    takenAfter?: string;
    takenBefore?: string;
  }) => Promise<void>;
  onClearLocalCache: () => Promise<void>;
}

const PULL_SCOPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'All Photos (Full Library)' },
  { value: 500, label: 'Latest 500 Photos' },
  { value: 2000, label: 'Latest 2,000 Photos' },
  { value: 5000, label: 'Latest 5,000 Photos' },
  { value: 10000, label: 'Latest 10,000 Photos' },
];

async function fileToThumbnail(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  const origW = bitmap.width;
  const origH = bitmap.height;
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(origW, origH));
  const w = Math.max(1, Math.round(origW * scale));
  const h = Math.max(1, Math.round(origH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    width: origW,
    height: origH,
  };
}

export function LibraryIngestView({
  assets,
  immichStatus,
  settings,
  pullProgress,
  busyAction,
  onUploadPhotos,
  onSaveImmichConfig,
  onTestImmichConfig,
  onDisconnectImmich,
  onIngestImmich,
  onClearLocalCache,
}: LibraryIngestViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<'all' | 'eligible' | 'excluded'>('all');
  const [assetQuery, setAssetQuery] = useState('');
  const [uploadCity, setUploadCity] = useState('');
  const [uploadStatus, setUploadStatus] = useState<{
    text: string;
    percent: number;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [immichUrl, setImmichUrl] = useState(immichStatus.baseUrl || '');
  const [immichApiKey, setImmichApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    reachable: boolean;
    message: string;
  } | null>(null);

  const [maxAssets, setMaxAssets] = useState<number>(settings.maxAssetsPerPull ?? 0);
  const [takenAfter, setTakenAfter] = useState('');
  const [takenBefore, setTakenBefore] = useState('');

  useEffect(() => {
    if (immichStatus.baseUrl) {
      setImmichUrl(immichStatus.baseUrl);
    }
  }, [immichStatus.baseUrl]);

  useEffect(() => {
    setMaxAssets(settings.maxAssetsPerPull ?? 0);
  }, [settings.maxAssetsPerPull]);

  const filtered = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter === 'eligible' && a.excludedReason) return false;
      if (filter === 'excluded' && !a.excludedReason) return false;
      if (!q) return true;
      return (
        a.fileName.toLowerCase().includes(q) ||
        a.originalPath.toLowerCase().includes(q) ||
        (a.city || '').toLowerCase().includes(q) ||
        (a.exifModel || '').toLowerCase().includes(q)
      );
    });
  }, [assets, filter, assetQuery]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 60);
    if (files.length === 0) return;

    setUploadStatus({
      text: `Reading EXIF & resizing 0 / ${files.length} photos...`,
      percent: 4,
    });
    try {
      const payload = [];
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        let parsedExif: Record<string, unknown> | null = null;
        try {
          parsedExif = (await exifr.parse(file, {
            gps: true,
            exif: true,
            tiff: true,
          })) as Record<string, unknown> | null;
        } catch {
          parsedExif = null;
        }

        const thumb = await fileToThumbnail(file);
        const dtRaw = parsedExif?.DateTimeOriginal || parsedExif?.CreateDate;
        const dtIso =
          dtRaw instanceof Date && !Number.isNaN(dtRaw.getTime())
            ? dtRaw.toISOString()
            : new Date(file.lastModified || Date.now()).toISOString();

        payload.push({
          fileName: file.name,
          originalPath: `/uploads/${file.name}`,
          localDateTime: dtIso,
          city: uploadCity.trim() || null,
          country: null,
          latitude: typeof parsedExif?.latitude === 'number' ? parsedExif.latitude : null,
          longitude: typeof parsedExif?.longitude === 'number' ? parsedExif.longitude : null,
          exifMake: typeof parsedExif?.Make === 'string' ? parsedExif.Make : null,
          exifModel: typeof parsedExif?.Model === 'string' ? parsedExif.Model : null,
          width: thumb.width,
          height: thumb.height,
          smartTags: [],
          thumbnailDataUrl: thumb.dataUrl,
        });

        const pct = Math.round(((idx + 1) / files.length) * 75);
        setUploadStatus({
          text: `Prepared ${idx + 1} / ${files.length} photos...`,
          percent: pct,
        });
      }

      setUploadStatus({
        text: `Extracting CIELAB palettes & clustering ${payload.length} photos...`,
        percent: 88,
      });
      await onUploadPhotos(payload);
      setUploadStatus(null);
    } catch {
      setUploadStatus(null);
    }
  };

  const isPulling = Boolean(pullProgress?.active) || busyAction === 'immich-ingest';

  const activeDiagnostic = testResult
    ? { ok: testResult.reachable, text: testResult.message }
    : immichStatus.lastError
      ? { ok: false, text: immichStatus.lastError }
      : null;

  return (
    <div className="space-y-6">
      {/* Top 2-Column Ingestion Strip */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 items-stretch">
        {/* Live Immich Server Connection */}
        <section className="flex flex-col justify-between rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] p-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Server className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  Immich Server Connection
                </h2>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                  immichStatus.reachable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : immichStatus.configured
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {immichStatus.reachable ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : immichStatus.configured ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : null}
                {immichStatus.reachable
                  ? `Connected (${immichStatus.serverVersion || 'live'})`
                  : immichStatus.configured
                    ? 'Unreachable'
                    : 'Not Connected'}
              </span>
            </div>

            <div className="mt-3.5 space-y-1.5 text-xs border-b border-zinc-100 dark:border-white/[0.06] pb-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500 dark:text-zinc-400">Credential source</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200 text-right">
                  {immichStatus.source === 'saved'
                    ? 'Saved in app (AES-256 encrypted)'
                    : immichStatus.source === 'env'
                      ? 'Container environment variables'
                      : 'Not configured'}
                </span>
              </div>
              {immichStatus.maskedApiKey && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500 dark:text-zinc-400">Active API key</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200">
                    {immichStatus.maskedApiKey}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3.5">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Immich Server URL
                </span>
                <input
                  type="url"
                  value={immichUrl}
                  onChange={(e) => {
                    setImmichUrl(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="http://192.168.1.50:2283 or https://photos.yourdomain.com"
                  className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Immich API Key
                </span>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={immichApiKey}
                    onChange={(e) => {
                      setImmichApiKey(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={
                      immichStatus.configured
                        ? 'Saved key active (enter new key to replace)'
                        : 'Paste key from Immich Account Settings -> API Keys'
                    }
                    autoComplete="off"
                    className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] pl-3 pr-9 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </label>

              {/* Pull Scope & Optional Date Window */}
              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Pull Scope
                  </span>
                  <select
                    value={maxAssets}
                    onChange={(e) => setMaxAssets(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                  >
                    {PULL_SCOPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    From Date (opt.)
                  </span>
                  <input
                    type="date"
                    value={takenAfter}
                    onChange={(e) => setTakenAfter(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-2.5 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    To Date (opt.)
                  </span>
                  <input
                    type="date"
                    value={takenBefore}
                    onChange={(e) => setTakenBefore(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-2.5 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                  />
                </label>
              </div>
            </div>

            {activeDiagnostic && (
              <div
                className={`mt-3.5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
                  activeDiagnostic.ok
                    ? 'border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                    : 'border-rose-200 dark:border-rose-500/25 bg-rose-50/70 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
                }`}
              >
                {activeDiagnostic.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>{activeDiagnostic.text}</span>
              </div>
            )}

            <p className="mt-3.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Required Immich scopes:{' '}
              <code className="font-mono text-zinc-700 dark:text-zinc-300">
                asset.read, asset.view, album.read, album.create, albumAsset.create
              </code>{' '}
              (or <strong className="font-medium text-zinc-700 dark:text-zinc-300">All</strong>).
              Previously pulled thumbnails and CIELAB palettes stay cached in SQLite so re-scans only download new photos.
              {immichStatus.source === 'saved' && (
                <>
                  {' '}
                  Click{' '}
                  <strong className="font-medium text-zinc-700 dark:text-zinc-300">Disconnect</strong>{' '}
                  to fall back to container environment variables.
                </>
              )}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-zinc-100 dark:border-white/[0.06]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!immichUrl.trim() || testing || busyAction !== null || isPulling}
                onClick={async () => {
                  setTestResult(null);
                  setTesting(true);
                  try {
                    const res = await onTestImmichConfig(immichUrl.trim(), immichApiKey.trim());
                    setTestResult({
                      reachable: res.reachable,
                      message: res.reachable
                        ? `Reachable (${res.serverVersion || 'connected'})`
                        : res.lastError || 'Could not reach Immich server',
                    });
                  } catch (err) {
                    setTestResult({
                      reachable: false,
                      message: err instanceof Error ? err.message : 'Test failed',
                    });
                  } finally {
                    setTesting(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.05] disabled:opacity-45 whitespace-nowrap shrink-0 transition-colors"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlugZap className="h-3.5 w-3.5" />
                )}
                {testing ? 'Testing...' : 'Test'}
              </button>

              <button
                type="button"
                disabled={
                  !immichUrl.trim() ||
                  (!immichApiKey.trim() && !immichStatus.configured) ||
                  busyAction !== null ||
                  isPulling
                }
                onClick={async () => {
                  setTestResult(null);
                  await onSaveImmichConfig(immichUrl.trim(), immichApiKey.trim());
                  setImmichApiKey('');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3.5 py-2 text-xs font-medium text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-45 whitespace-nowrap shrink-0 transition-opacity"
              >
                {busyAction === 'immich-save' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {busyAction === 'immich-save' ? 'Saving...' : 'Save'}
              </button>

              <button
                type="button"
                disabled={!immichStatus.reachable || busyAction !== null || isPulling}
                onClick={() =>
                  onIngestImmich({
                    maxAssets,
                    takenAfter: takenAfter ? `${takenAfter}T00:00:00.000Z` : undefined,
                    takenBefore: takenBefore ? `${takenBefore}T23:59:59.999Z` : undefined,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-45 whitespace-nowrap shrink-0 transition-colors tabular-nums"
              >
                {isPulling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudDownload className="h-3.5 w-3.5" />
                )}
                {isPulling
                  ? `Pulling ${pullProgress?.percent ?? 0}%...`
                  : 'Pull & Scan'}
              </button>
            </div>

            {immichStatus.source === 'saved' && (
              <button
                type="button"
                disabled={busyAction !== null || isPulling}
                onClick={async () => {
                  setTestResult(null);
                  await onDisconnectImmich();
                  setImmichUrl('');
                  setImmichApiKey('');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-45 whitespace-nowrap shrink-0 transition-colors"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </button>
            )}
          </div>
        </section>

        {/* Real Local Photo Upload & EXIF/CIELAB Extractor */}
        <section className="flex flex-col justify-between rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] p-6">
          <div className="flex flex-1 flex-col">
            <div className="flex items-center gap-2.5">
              <ImagePlus className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Ingest Local Photos
              </h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Drop real JPEG, PNG, or WebP photos to extract camera EXIF, GPS coordinates, timestamps, and 5-color CIELAB palettes directly into the local SQLite cache.
            </p>

            <div className="mt-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Fallback City Label (optional)
                </span>
                <input
                  type="text"
                  value={uploadCity}
                  onChange={(e) => setUploadCity(e.target.value)}
                  placeholder="Used for photos without GPS EXIF (e.g. Kyoto)"
                  className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                />
              </label>
            </div>

            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                void handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 flex flex-1 min-h-[168px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                dragActive
                  ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
                  : 'border-zinc-300 dark:border-white/[0.14] bg-zinc-50/50 dark:bg-[#0D1017] hover:border-indigo-400 dark:hover:border-indigo-400/70'
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#151923] text-zinc-500 dark:text-zinc-400">
                {uploadStatus ? (
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                ) : (
                  <ImagePlus className="h-5 w-5" />
                )}
              </div>
              <p className="mt-3 text-xs font-medium text-zinc-800 dark:text-zinc-200 tabular-nums">
                {uploadStatus
                  ? `${uploadStatus.text} (${uploadStatus.percent}%)`
                  : 'Drop JPEG, PNG, or WebP photos here, or click to browse'}
              </p>
              {uploadStatus ? (
                <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200 dark:bg-white/[0.08]">
                  <div
                    className="h-full w-full origin-left rounded-full bg-indigo-600 dark:bg-indigo-400 transition-transform duration-200 ease-out"
                    style={{ transform: `scaleX(${Math.max(4, uploadStatus.percent) / 100})` }}
                  />
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Resized to 320px in-browser before server-side CIELAB extraction · Up to 60 photos per batch
                </p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Asset Cache Table */}
      <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-white/[0.07] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              SQLite Asset &amp; Feature Cache
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              Showing {filtered.length.toLocaleString()} of {assets.length.toLocaleString()} indexed assets
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {assets.length > 0 && (
              <div className="relative w-48 sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                <input
                  type="text"
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  placeholder="Filter filename or city..."
                  className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50/70 dark:bg-[#0D1017] pl-8 pr-7 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
                {assetQuery && (
                  <button
                    type="button"
                    onClick={() => setAssetQuery('')}
                    aria-label="Clear asset search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-100/80 dark:bg-[#0D1017] p-1">
              {(['all', 'eligible', 'excluded'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                    filter === tab
                      ? 'bg-white dark:bg-[#1B202C] text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {assets.length > 0 && (
              <button
                type="button"
                disabled={busyAction !== null || isPulling}
                onClick={onClearLocalCache}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/60 dark:hover:text-rose-400 dark:hover:border-rose-500/30 dark:hover:bg-rose-950/30 disabled:opacity-45 whitespace-nowrap shrink-0 transition-colors"
              >
                {busyAction === 'clear-cache' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {busyAction === 'clear-cache' ? 'Clearing...' : 'Clear Cache'}
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#171B24] text-zinc-500 dark:text-zinc-400">
              <Database className="h-4 w-4" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {assets.length === 0 ? 'No cached assets yet' : 'No assets match this filter'}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {assets.length === 0
                ? 'Save your Immich URL and API key above and click Pull & Scan, or drop local photos on the right.'
                : 'Try clearing the search query or switching between All, Eligible, and Excluded tabs.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200/80 dark:border-white/[0.07] bg-zinc-50/80 dark:bg-[#0D1017] text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 pl-6 pr-3 font-medium">Asset</th>
                  <th className="py-2.5 px-3 font-medium">Captured (UTC)</th>
                  <th className="py-2.5 px-3 font-medium">Location</th>
                  <th className="py-2.5 px-3 font-medium">Camera EXIF</th>
                  <th className="py-2.5 px-3 font-medium">5-Color CIELAB</th>
                  <th className="py-2.5 pl-3 pr-6 font-medium">Stage 1 Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                {filtered.slice(0, 250).map((asset) => (
                  <tr
                    key={asset.id}
                    className="hover:bg-zinc-50/70 dark:hover:bg-white/[0.025] transition-colors"
                  >
                    <td className="py-2.5 pl-6 pr-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-12 overflow-hidden rounded bg-zinc-100 dark:bg-[#171B24] shrink-0">
                          <ThumbnailImage src={asset.thumbnailUrl} alt={asset.fileName} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">
                            {asset.fileName}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[220px]">
                            {asset.originalPath}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {new Date(asset.localDateTime).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                      {asset.city
                        ? `${asset.city}${asset.country ? `, ${asset.country}` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {asset.exifMake && asset.exifModel
                        ? `${asset.exifMake} ${asset.exifModel}`
                        : 'None'}
                    </td>
                    <td className="py-2.5 px-3 w-36">
                      {asset.palette.length > 0 ? (
                        <PaletteBar swatches={asset.palette} heightClass="h-2.5" interactive={false} />
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">Skipped</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 pr-6">
                      {asset.excludedReason ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {asset.excludedReason}
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Eligible · LAB cached
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 250 && (
              <div className="border-t border-zinc-100 dark:border-white/[0.06] px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                Showing first 250 of {filtered.length.toLocaleString()} matching assets. Use the search box above to narrow down specific files or cities.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
