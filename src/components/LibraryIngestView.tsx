import exifr from 'exifr';
import {
  CloudDownload,
  Eye,
  EyeOff,
  ImagePlus,
  PlugZap,
  RotateCcw,
  Save,
  Server,
  Unplug,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRecord, ImmichStatus } from '../shared/types.ts';
import { PaletteBar } from './PaletteBar.tsx';

interface LibraryIngestViewProps {
  assets: AssetRecord[];
  immichStatus: ImmichStatus;
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
  onIngestImmich: () => Promise<void>;
  onResetSample: () => Promise<void>;
}

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
  busyAction,
  onUploadPhotos,
  onSaveImmichConfig,
  onTestImmichConfig,
  onDisconnectImmich,
  onIngestImmich,
  onResetSample,
}: LibraryIngestViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<'all' | 'eligible' | 'excluded'>('all');
  const [uploadCity, setUploadCity] = useState('');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [immichUrl, setImmichUrl] = useState(immichStatus.baseUrl || '');
  const [immichApiKey, setImmichApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    reachable: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (immichStatus.baseUrl) {
      setImmichUrl(immichStatus.baseUrl);
    }
  }, [immichStatus.baseUrl]);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (filter === 'eligible') return !a.excludedReason;
      if (filter === 'excluded') return Boolean(a.excludedReason);
      return true;
    });
  }, [assets, filter]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 40);
    if (files.length === 0) return;

    setUploadProgress(`Reading EXIF & generating thumbnails for ${files.length} photos...`);
    try {
      const payload = [];
      for (const file of files) {
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
      }

      setUploadProgress('Extracting CIELAB palettes & running 4-stage clustering...');
      await onUploadPhotos(payload);
      setUploadProgress(null);
    } catch {
      setUploadProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top 2-Column Ingestion Strip */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 items-stretch">
        {/* Live Immich Server Connection */}
        <section className="flex flex-col justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Server className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Immich Server Connection
                </h2>
              </div>
              <span
                className={`text-xs font-medium ${
                  immichStatus.reachable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : immichStatus.configured
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                {immichStatus.reachable
                  ? `Connected (${immichStatus.serverVersion || 'live'})`
                  : immichStatus.configured
                    ? 'Unreachable'
                    : 'Safe Demo Mode'}
              </span>
            </div>

            <div className="mt-3 space-y-1.5 text-xs border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Credential source</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {immichStatus.source === 'saved'
                    ? 'Saved in app (AES-256 encrypted on server)'
                    : immichStatus.source === 'env'
                      ? 'Container environment variables'
                      : 'None — local demo library active'}
                </span>
              </div>
              {immichStatus.maskedApiKey && (
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 dark:text-neutral-400">Saved API key</span>
                  <span className="font-mono text-neutral-800 dark:text-neutral-200">
                    {immichStatus.maskedApiKey}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
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
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-[#0B0E14] px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
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
                    className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-[#0B0E14] pl-3 pr-9 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </label>
            </div>

            {testResult && (
              <p
                className={`mt-2.5 text-xs ${
                  testResult.reachable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {testResult.message}
              </p>
            )}

            {!testResult && immichStatus.lastError && (
              <p className="mt-2.5 text-xs text-rose-600 dark:text-rose-400">
                {immichStatus.lastError}
              </p>
            )}

            <p className="mt-3 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Saving credentials only verifies server reachability—nothing is pulled or written to your Immich library until you click{' '}
              <strong className="font-medium text-neutral-700 dark:text-neutral-300">
                Pull &amp; Scan from Immich
              </strong>{' '}
              or approve an album sync.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 pt-4 border-t border-neutral-100 dark:border-neutral-800/80">
            <button
              type="button"
              disabled={!immichUrl.trim() || busyAction !== null}
              onClick={async () => {
                setTestResult(null);
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
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <PlugZap className="h-3.5 w-3.5" />
              Test
            </button>

            <button
              type="button"
              disabled={!immichUrl.trim() || (!immichApiKey.trim() && !immichStatus.configured) || busyAction !== null}
              onClick={async () => {
                setTestResult(null);
                await onSaveImmichConfig(immichUrl.trim(), immichApiKey.trim());
                setImmichApiKey('');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 px-3.5 py-2 text-xs font-medium text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              {busyAction === 'immich-save' ? 'Saving...' : 'Save Connection'}
            </button>

            {immichStatus.source === 'saved' && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  setTestResult(null);
                  await onDisconnectImmich();
                  setImmichUrl('');
                  setImmichApiKey('');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 whitespace-nowrap shrink-0"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </button>
            )}

            <button
              type="button"
              disabled={!immichStatus.reachable || busyAction !== null}
              onClick={onIngestImmich}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <CloudDownload className="h-3.5 w-3.5" />
              {busyAction === 'immich-ingest' ? 'Pulling...' : 'Pull & Scan from Immich'}
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={onResetSample}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Demo
            </button>
          </div>
        </section>

        {/* Real Local Photo Upload & EXIF/CIELAB Extractor */}
        <section className="flex flex-col justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <ImagePlus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Ingest Local Photos (Real EXIF + CIELAB)
                </h2>
              </div>
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Drop real JPEG/PNG photos to extract camera EXIF, GPS, timestamps, and 5-color CIELAB palettes directly into the SQLite cache.
            </p>

            <div className="mt-3">
              <input
                type="text"
                value={uploadCity}
                onChange={(e) => setUploadCity(e.target.value)}
                placeholder="Optional city label for photos without GPS (e.g. Kyoto)"
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-[#0B0E14] px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div
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
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-7 text-center transition-colors ${
                dragActive
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                  : 'border-neutral-300 dark:border-neutral-700 hover:border-indigo-400 dark:hover:border-indigo-500'
              }`}
            >
              <ImagePlus className="h-6 w-6 text-neutral-400" />
              <p className="mt-2 text-xs font-medium text-neutral-800 dark:text-neutral-200">
                {uploadProgress || 'Drop JPEG or PNG photos here, or click to select'}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                Thumbnails are resized to 320px in-browser before CIELAB extraction
              </p>
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
      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              SQLite Asset &amp; Feature Cache
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
              Showing {filtered.length} of {assets.length} indexed assets
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 p-1 border border-neutral-200/80 dark:border-neutral-800">
            {(['all', 'eligible', 'excluded'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400">
                <th className="py-2.5 pl-6 pr-3 font-medium">Asset</th>
                <th className="py-2.5 px-3 font-medium">Captured (UTC)</th>
                <th className="py-2.5 px-3 font-medium">Location</th>
                <th className="py-2.5 px-3 font-medium">Camera EXIF</th>
                <th className="py-2.5 px-3 font-medium">5-Color CIELAB</th>
                <th className="py-2.5 pl-3 pr-6 font-medium">Stage 1 Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
              {filtered.map((asset) => (
                <tr
                  key={asset.id}
                  className="hover:bg-neutral-50/70 dark:hover:bg-neutral-900/40 transition-colors"
                >
                  <td className="py-2.5 pl-6 pr-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.fileName}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-9 w-12 rounded object-cover bg-neutral-100 dark:bg-neutral-900 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate max-w-[200px]">
                          {asset.fileName}
                        </div>
                        <div className="text-[11px] text-neutral-500 truncate max-w-[220px]">
                          {asset.originalPath}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono tabular-nums text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                    {new Date(asset.localDateTime).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </td>
                  <td className="py-2.5 px-3 text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                    {asset.city ? `${asset.city}${asset.country ? `, ${asset.country}` : ''}` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                    {asset.exifMake && asset.exifModel
                      ? `${asset.exifMake} ${asset.exifModel}`
                      : 'None'}
                  </td>
                  <td className="py-2.5 px-3 w-36">
                    {asset.palette.length > 0 ? (
                      <PaletteBar swatches={asset.palette} heightClass="h-2.5" interactive={false} />
                    ) : (
                      <span className="text-neutral-400">Skipped</span>
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
        </div>
      </section>
    </div>
  );
}
