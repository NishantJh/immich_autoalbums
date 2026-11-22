import {
  Loader2,
  MapPin,
  RotateCcw,
  Save,
  Search,
  Sliders,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  HomeBaseMode,
  OrganizerSettings,
  PipelineRunSummary,
} from '../shared/types.ts';

interface RulesDeployViewProps {
  settings: OrganizerSettings;
  pipelineSummary: PipelineRunSummary | null;
  isBusy: boolean;
  onSaveSettings: (payload: {
    settings?: Partial<OrganizerSettings>;
    rerun: boolean;
  }) => Promise<void>;
}

interface GeocodeResult {
  city: string;
  country: string | null;
  displayName: string;
  lat: number;
  lng: number;
}

const DEFAULT_EXCLUDED_PATHS = ['WhatsApp', 'Downloads', 'Screenshots'];

export function RulesDeployView({
  settings,
  pipelineSummary,
  isBusy,
  onSaveSettings,
}: RulesDeployViewProps) {
  const [titlePrefix, setTitlePrefix] = useState(settings.titlePrefix);
  const [useStructuredPrefix, setUseStructuredPrefix] = useState(settings.useStructuredPrefix);
  const [createMasterAlbum, setCreateMasterAlbum] = useState(settings.createMasterAlbum);
  const [createMoodSubalbums, setCreateMoodSubalbums] = useState(settings.createMoodSubalbums);
  const [ignoreScreenshots, setIgnoreScreenshots] = useState(settings.ignoreScreenshots);
  const [scanIntervalHours, setScanIntervalHours] = useState(settings.scanIntervalHours);
  const [excludedPathsText, setExcludedPathsText] = useState(settings.excludedPaths.join(', '));

  // Home Base state
  const [homeBaseMode, setHomeBaseMode] = useState<HomeBaseMode>(settings.homeBaseMode || 'auto');
  const [homeBaseCity, setHomeBaseCity] = useState(settings.homeBaseCityOverride || '');
  const [homeBaseLatText, setHomeBaseLatText] = useState(
    settings.homeBaseLatOverride !== null && settings.homeBaseLatOverride !== undefined
      ? String(settings.homeBaseLatOverride)
      : ''
  );
  const [homeBaseLngText, setHomeBaseLngText] = useState(
    settings.homeBaseLngOverride !== null && settings.homeBaseLngOverride !== undefined
      ? String(settings.homeBaseLngOverride)
      : ''
  );

  // Optional English city search state
  const [cityQuery, setCityQuery] = useState('');
  const [searchingCity, setSearchingCity] = useState(false);
  const [cityResults, setCityResults] = useState<GeocodeResult[]>([]);
  const [citySearchError, setCitySearchError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setTitlePrefix(settings.titlePrefix);
    setUseStructuredPrefix(settings.useStructuredPrefix);
    setCreateMasterAlbum(settings.createMasterAlbum);
    setCreateMoodSubalbums(settings.createMoodSubalbums);
    setIgnoreScreenshots(settings.ignoreScreenshots);
    setScanIntervalHours(settings.scanIntervalHours);
    setExcludedPathsText(settings.excludedPaths.join(', '));
    setHomeBaseMode(settings.homeBaseMode || 'auto');
    setHomeBaseCity(settings.homeBaseCityOverride || '');
    setHomeBaseLatText(
      settings.homeBaseLatOverride !== null && settings.homeBaseLatOverride !== undefined
        ? String(settings.homeBaseLatOverride)
        : ''
    );
    setHomeBaseLngText(
      settings.homeBaseLngOverride !== null && settings.homeBaseLngOverride !== undefined
        ? String(settings.homeBaseLngOverride)
        : ''
    );
  }, [settings]);

  const parsedPaths = useMemo(
    () =>
      excludedPathsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [excludedPathsText]
  );

  const parsedLat = useMemo(() => {
    const trimmed = homeBaseLatText.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
  }, [homeBaseLatText]);

  const parsedLng = useMemo(() => {
    const trimmed = homeBaseLngText.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
  }, [homeBaseLngText]);

  const candidates = pipelineSummary?.stage2.candidateHomeBases || [];

  const isDirty = useMemo(() => {
    return (
      titlePrefix !== settings.titlePrefix ||
      useStructuredPrefix !== settings.useStructuredPrefix ||
      createMasterAlbum !== settings.createMasterAlbum ||
      createMoodSubalbums !== settings.createMoodSubalbums ||
      ignoreScreenshots !== settings.ignoreScreenshots ||
      scanIntervalHours !== settings.scanIntervalHours ||
      parsedPaths.join(',') !== settings.excludedPaths.join(',') ||
      homeBaseMode !== settings.homeBaseMode ||
      homeBaseCity.trim() !== (settings.homeBaseCityOverride || '').trim() ||
      parsedLat !== (settings.homeBaseLatOverride ?? null) ||
      parsedLng !== (settings.homeBaseLngOverride ?? null)
    );
  }, [
    titlePrefix,
    useStructuredPrefix,
    createMasterAlbum,
    createMoodSubalbums,
    ignoreScreenshots,
    scanIntervalHours,
    parsedPaths,
    homeBaseMode,
    homeBaseCity,
    parsedLat,
    parsedLng,
    settings,
  ]);

  const previewTitles = useMemo(() => {
    const prefix = titlePrefix.trim() ? `${titlePrefix.trim()} ` : '';
    const master = useStructuredPrefix
      ? `${prefix}2026-08 • Kyoto Trip (All)`
      : `${prefix}Kyoto Trip`;
    const chapter1 = useStructuredPrefix
      ? `${prefix}2026-08 • Kyoto Trip — Golden Hour`
      : `${prefix}Kyoto Trip — Golden Hour`;
    const chapter2 = useStructuredPrefix
      ? `${prefix}2026-08 • Kyoto Trip — Night Neon`
      : `${prefix}Kyoto Trip — Night Neon`;
    return { master, chapter1, chapter2 };
  }, [titlePrefix, useStructuredPrefix]);

  const handleLookupCity = async () => {
    const q = cityQuery.trim();
    if (q.length < 2) {
      setCitySearchError('Enter at least 2 characters to look up a city.');
      return;
    }
    setSearchingCity(true);
    setCitySearchError(null);
    setCityResults([]);
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { results?: GeocodeResult[]; error?: string };
      if (!res.ok) {
        setCitySearchError(data.error || 'City lookup failed.');
        return;
      }
      if (!data.results || data.results.length === 0) {
        setCitySearchError('No matching cities found. Try adding a country name or enter coordinates manually.');
        return;
      }
      setCityResults(data.results);
    } catch {
      setCitySearchError(
        'City lookup unavailable offline. Enter City Name, Latitude, and Longitude manually below.'
      );
    } finally {
      setSearchingCity(false);
    }
  };

  const handlePickGeocodeResult = (r: GeocodeResult) => {
    setHomeBaseMode('manual');
    setHomeBaseCity(r.city);
    setHomeBaseLatText(String(r.lat));
    setHomeBaseLngText(String(r.lng));
    setCityResults([]);
    setCityQuery('');
    setValidationError(null);
  };

  const handleSaveForm = async () => {
    setValidationError(null);
    if (homeBaseMode === 'manual') {
      if (parsedLat === null || parsedLng === null) {
        setValidationError(
          'Manual Home Base requires valid Latitude (-90 to 90) and Longitude (-180 to 180). Search a city, pick a detected location, or enter coordinates.'
        );
        return;
      }
      if (Math.abs(parsedLat) < 0.001 && Math.abs(parsedLng) < 0.001) {
        setValidationError('Coordinates (0, 0) are invalid. Enter your actual city coordinates.');
        return;
      }
    }

    await onSaveSettings({
      settings: {
        titlePrefix,
        useStructuredPrefix,
        createMasterAlbum,
        createMoodSubalbums,
        ignoreScreenshots,
        scanIntervalHours: Math.max(1, Math.min(168, Number(scanIntervalHours) || 6)),
        excludedPaths: parsedPaths,
        homeBaseMode,
        homeBaseCityOverride: homeBaseCity.trim(),
        homeBaseLatOverride: homeBaseMode === 'manual' ? parsedLat : null,
        homeBaseLngOverride: homeBaseMode === 'manual' ? parsedLng : null,
      },
      rerun: true,
    });
  };

  const handleResetDefaults = () => {
    setTitlePrefix('');
    setUseStructuredPrefix(true);
    setCreateMasterAlbum(true);
    setCreateMoodSubalbums(true);
    setIgnoreScreenshots(true);
    setScanIntervalHours(6);
    setExcludedPathsText(DEFAULT_EXCLUDED_PATHS.join(', '));
    setHomeBaseMode('auto');
    setHomeBaseCity('');
    setHomeBaseLatText('');
    setHomeBaseLngText('');
    setCityResults([]);
    setCitySearchError(null);
    setValidationError(null);
  };

  const activeStage2 = pipelineSummary?.stage2;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 items-start">
      <div className="xl:col-span-2 space-y-5">
        {/* Home Base Location Configuration */}
        <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-white/[0.07] px-6 py-4">
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Home Base Location
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Photos within {settings.homeRadiusKm} km of Home Base cluster as Local Events; photos farther away cluster as Trips.
                </p>
              </div>
            </div>

            {activeStage2 && activeStage2.homeBaseCity !== '—' && (
              <div className="text-right text-xs">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {activeStage2.homeBaseCity}
                  {activeStage2.homeBaseCountry &&
                  activeStage2.homeBaseCountry !== activeStage2.homeBaseCity
                    ? `, ${activeStage2.homeBaseCountry}`
                    : ''}
                </div>
                {activeStage2.homeBaseSource !== 'disabled' && (
                  <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                    {activeStage2.homeBaseLat.toFixed(4)}, {activeStage2.homeBaseLng.toFixed(4)} ·{' '}
                    {activeStage2.homeBaseDistinctDays}d ({activeStage2.homeBaseAssetCount} photos)
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            {/* Mode Segmented Control */}
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-100/80 dark:bg-[#0D1017] p-1">
              {(
                [
                  { id: 'auto', label: 'Auto-Detect' },
                  { id: 'manual', label: 'Manual Override' },
                  { id: 'disabled', label: 'Disabled' },
                ] as const
              ).map((opt) => {
                const active = homeBaseMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setHomeBaseMode(opt.id);
                      if (
                        opt.id === 'manual' &&
                        !homeBaseLatText.trim() &&
                        !homeBaseLngText.trim() &&
                        activeStage2 &&
                        activeStage2.homeBaseSource !== 'disabled' &&
                        (Math.abs(activeStage2.homeBaseLat) > 0.001 ||
                          Math.abs(activeStage2.homeBaseLng) > 0.001)
                      ) {
                        setHomeBaseLatText(String(activeStage2.homeBaseLat));
                        setHomeBaseLngText(String(activeStage2.homeBaseLng));
                        if (
                          !homeBaseCity.trim() &&
                          activeStage2.homeBaseCity &&
                          activeStage2.homeBaseCity !== '—' &&
                          activeStage2.homeBaseCity !== 'Disabled'
                        ) {
                          setHomeBaseCity(activeStage2.homeBaseCity);
                        }
                      }
                      setValidationError(null);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-[#1B202C] text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {homeBaseMode === 'auto' && (
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Auto-detect selects the location where you have taken photos across the most{' '}
                <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                  distinct calendar days
                </strong>
                . If you have only pulled a partial slice of your library (such as a recent trip),
                switch to <strong className="font-medium text-zinc-700 dark:text-zinc-300">Manual Override</strong> to pin your real home city.
              </p>
            )}

            {homeBaseMode === 'disabled' && (
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Home Base separation is disabled. All geotagged photos will be grouped evenly by
                city/region and time gap without suppressing any city as home.
              </p>
            )}

            {homeBaseMode === 'manual' && (
              <div className="space-y-4">
                {/* Pick from detected library locations */}
                {candidates.length > 0 && (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Quick-pick from detected library locations
                    </span>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const picked = candidates.find((c) => c.geohash === e.target.value);
                        if (picked) {
                          setHomeBaseCity(picked.city);
                          setHomeBaseLatText(String(picked.lat));
                          setHomeBaseLngText(String(picked.lng));
                          setValidationError(null);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    >
                      <option value="">Choose a location found in your photos...</option>
                      {candidates.map((c) => (
                        <option key={c.geohash} value={c.geohash}>
                          {c.city}
                          {c.country && c.country !== c.city ? `, ${c.country}` : ''} —{' '}
                          {c.distinctDays} {c.distinctDays === 1 ? 'day' : 'days'} · {c.assetCount}{' '}
                          photos ({c.lat.toFixed(3)}, {c.lng.toFixed(3)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Search any city in English */}
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Or search any city worldwide (English)
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={cityQuery}
                      onChange={(e) => setCityQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleLookupCity();
                        }
                      }}
                      placeholder="e.g. Austin, Texas or Bengaluru, India"
                      className="flex-1 min-w-0 rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={searchingCity}
                      onClick={() => void handleLookupCity()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] bg-white dark:bg-[#171B24] px-3.5 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.06] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                    >
                      {searchingCity ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      Look Up
                    </button>
                  </div>

                  {citySearchError && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      {citySearchError}
                    </p>
                  )}

                  {cityResults.length > 0 && (
                    <div className="divide-y divide-zinc-100 dark:divide-white/[0.06] rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50/70 dark:bg-[#0D1017] overflow-hidden">
                      {cityResults.map((r, idx) => (
                        <button
                          key={`${r.lat}-${r.lng}-${idx}`}
                          type="button"
                          onClick={() => handlePickGeocodeResult(r)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-indigo-50/70 dark:hover:bg-indigo-500/[0.12] transition-colors"
                        >
                          <span className="truncate text-zinc-800 dark:text-zinc-200">
                            {r.displayName}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                            {r.lat}, {r.lng}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Direct Offline City + Lat + Lng inputs */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Home City Label
                    </span>
                    <input
                      type="text"
                      value={homeBaseCity}
                      onChange={(e) => setHomeBaseCity(e.target.value)}
                      placeholder="e.g. Bengaluru"
                      className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Latitude
                    </span>
                    <input
                      type="number"
                      step="0.0001"
                      min={-90}
                      max={90}
                      value={homeBaseLatText}
                      onChange={(e) => setHomeBaseLatText(e.target.value)}
                      placeholder="e.g. 12.9716"
                      className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs font-mono tabular-nums text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Longitude
                    </span>
                    <input
                      type="number"
                      step="0.0001"
                      min={-180}
                      max={180}
                      value={homeBaseLngText}
                      onChange={(e) => setHomeBaseLngText(e.target.value)}
                      placeholder="e.g. 77.5946"
                      className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-xs font-mono tabular-nums text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    />
                  </label>
                </div>
              </div>
            )}

            {validationError && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-500/25 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {validationError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-white/[0.06]">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Saving immediately re-partitions Trips vs. Local Events across your cached library.
              </span>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleSaveForm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {isBusy ? 'Re-Clustering...' : 'Save Home Base & Re-Cluster'}
              </button>
            </div>
          </div>
        </section>

        {/* Exclusion Rules & Album Naming Safeguards */}
        <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-zinc-200/80 dark:border-white/[0.07] px-6 py-4">
            <Sliders className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Exclusion Rules &amp; Album Naming Safeguards
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Settings are stored in SQLite and applied automatically on every scan.
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Excluded source path keywords (comma-separated)
              </span>
              <input
                type="text"
                value={excludedPathsText}
                onChange={(e) => setExcludedPathsText(e.target.value)}
                placeholder="WhatsApp, Downloads, Screenshots"
                className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
              />
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                Assets whose file path contains any of these keywords are skipped during Stage 1 pre-filtering. Leave blank to disable path exclusions.
              </span>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Optional album title prefix
                </span>
                <input
                  type="text"
                  value={titlePrefix}
                  onChange={(e) => setTitlePrefix(e.target.value)}
                  placeholder="e.g. [Auto]"
                  className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Scheduled scan interval (hours)
                </span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={scanIntervalHours}
                  onChange={(e) => setScanIntervalHours(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-sm font-mono tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
                />
              </label>
            </div>

            <div className="divide-y divide-zinc-100 dark:divide-white/[0.06] rounded-lg border border-zinc-200/80 dark:border-white/[0.07]">
              <label className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-zinc-50/70 dark:hover:bg-white/[0.02] transition-colors">
                <input
                  type="checkbox"
                  checked={ignoreScreenshots}
                  onChange={(e) => setIgnoreScreenshots(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-indigo-600"
                />
                <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <strong className="block font-medium text-zinc-900 dark:text-zinc-100">
                    Exclude Suspected Screenshots (EXIF + Aspect-Ratio Heuristic)
                  </strong>
                  Automatically filter out images missing camera EXIF metadata that match phone or display aspect ratios (16:9, 19.5:9, 20:9) or have <code className="font-mono text-zinc-800 dark:text-zinc-200">screenshot</code> in the filename. Turn off to include all screenshots and EXIF-stripped exports.
                </span>
              </label>

              <label className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-zinc-50/70 dark:hover:bg-white/[0.02] transition-colors">
                <input
                  type="checkbox"
                  checked={useStructuredPrefix}
                  onChange={(e) => setUseStructuredPrefix(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-indigo-600"
                />
                <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <strong className="block font-medium text-zinc-900 dark:text-zinc-100">
                    Structured Prefix Naming
                  </strong>
                  Format titles as <code className="font-mono text-zinc-800 dark:text-zinc-200">YYYY-MM • Event — Chapter</code> so Immich&apos;s flat album list sorts chronologically.
                </span>
              </label>

              <label className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-zinc-50/70 dark:hover:bg-white/[0.02] transition-colors">
                <input
                  type="checkbox"
                  checked={createMasterAlbum}
                  onChange={(e) => setCreateMasterAlbum(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-indigo-600"
                />
                <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <strong className="block font-medium text-zinc-900 dark:text-zinc-100">
                    Create Master Event Album (All)
                  </strong>
                  Keep an overarching album containing all photos from an event alongside its visual sub-chapters.
                </span>
              </label>

              <label className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-zinc-50/70 dark:hover:bg-white/[0.02] transition-colors">
                <input
                  type="checkbox"
                  checked={createMoodSubalbums}
                  onChange={(e) => setCreateMoodSubalbums(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-indigo-600"
                />
                <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <strong className="block font-medium text-zinc-900 dark:text-zinc-100">
                    Color-Tone Sub-Chapter Splitting
                  </strong>
                  Split multi-scene events automatically when sliding-window CIELAB Earth Mover&apos;s Distance detects a lighting or palette shift.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-white/[0.06]">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleResetDefaults}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.05] hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Defaults
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={handleSaveForm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {isBusy
                  ? 'Saving...'
                  : isDirty
                    ? 'Save Rules & Re-Run'
                    : 'Re-Apply Rules'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Live Naming Preview Panel */}
      <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Immich Naming Preview
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            How a multi-scene event will appear in Immich&apos;s album list under your current rules.
          </p>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/[0.06] rounded-lg border border-zinc-200/80 dark:border-white/[0.07] bg-zinc-50/70 dark:bg-[#0D1017]">
          {createMasterAlbum && (
            <div className="px-3.5 py-2.5">
              <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {previewTitles.master}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Master event album
              </div>
            </div>
          )}
          {createMoodSubalbums && (
            <>
              <div className="px-3.5 py-2.5">
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {previewTitles.chapter1}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Color-tone chapter
                </div>
              </div>
              <div className="px-3.5 py-2.5">
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {previewTitles.chapter2}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Color-tone chapter
                </div>
              </div>
            </>
          )}
          {!createMasterAlbum && !createMoodSubalbums && (
            <div className="px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400">
              Enable at least one album output option on the left to generate albums.
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-zinc-100 dark:border-white/[0.06] text-xs text-zinc-500 dark:text-zinc-400 space-y-1.5">
          <div className="flex justify-between gap-2">
            <span>Home Base mode</span>
            <span className="font-medium text-zinc-800 dark:text-zinc-200 capitalize">
              {homeBaseMode === 'manual' && homeBaseCity.trim()
                ? `Manual (${homeBaseCity.trim()})`
                : homeBaseMode}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Screenshot heuristic</span>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {ignoreScreenshots ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Excluded keywords</span>
            <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {parsedPaths.length}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Scan cadence</span>
            <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              Every {scanIntervalHours || 6}h
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
