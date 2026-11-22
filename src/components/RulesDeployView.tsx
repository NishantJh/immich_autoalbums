import { Loader2, RotateCcw, Save, Sliders } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OrganizerSettings } from '../shared/types.ts';

interface RulesDeployViewProps {
  settings: OrganizerSettings;
  isBusy: boolean;
  onSaveSettings: (payload: {
    settings?: Partial<OrganizerSettings>;
    rerun: boolean;
  }) => Promise<void>;
}

const DEFAULT_EXCLUDED_PATHS = ['WhatsApp', 'Screenshots', 'Downloads', 'Memes', 'Telegram'];

export function RulesDeployView({
  settings,
  isBusy,
  onSaveSettings,
}: RulesDeployViewProps) {
  const [titlePrefix, setTitlePrefix] = useState(settings.titlePrefix);
  const [useStructuredPrefix, setUseStructuredPrefix] = useState(settings.useStructuredPrefix);
  const [createMasterAlbum, setCreateMasterAlbum] = useState(settings.createMasterAlbum);
  const [createMoodSubalbums, setCreateMoodSubalbums] = useState(settings.createMoodSubalbums);
  const [scanIntervalHours, setScanIntervalHours] = useState(settings.scanIntervalHours);
  const [excludedPathsText, setExcludedPathsText] = useState(settings.excludedPaths.join(', '));

  useEffect(() => {
    setTitlePrefix(settings.titlePrefix);
    setUseStructuredPrefix(settings.useStructuredPrefix);
    setCreateMasterAlbum(settings.createMasterAlbum);
    setCreateMoodSubalbums(settings.createMoodSubalbums);
    setScanIntervalHours(settings.scanIntervalHours);
    setExcludedPathsText(settings.excludedPaths.join(', '));
  }, [settings]);

  const parsedPaths = useMemo(
    () =>
      excludedPathsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [excludedPathsText]
  );

  const isDirty = useMemo(() => {
    return (
      titlePrefix !== settings.titlePrefix ||
      useStructuredPrefix !== settings.useStructuredPrefix ||
      createMasterAlbum !== settings.createMasterAlbum ||
      createMoodSubalbums !== settings.createMoodSubalbums ||
      scanIntervalHours !== settings.scanIntervalHours ||
      parsedPaths.join(',') !== settings.excludedPaths.join(',')
    );
  }, [
    titlePrefix,
    useStructuredPrefix,
    createMasterAlbum,
    createMoodSubalbums,
    scanIntervalHours,
    parsedPaths,
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

  const handleSaveForm = async () => {
    await onSaveSettings({
      settings: {
        titlePrefix,
        useStructuredPrefix,
        createMasterAlbum,
        createMoodSubalbums,
        scanIntervalHours: Math.max(1, Math.min(168, Number(scanIntervalHours) || 6)),
        excludedPaths: parsedPaths,
      },
      rerun: true,
    });
  };

  const handleResetDefaults = () => {
    setTitlePrefix('');
    setUseStructuredPrefix(true);
    setCreateMasterAlbum(true);
    setCreateMoodSubalbums(true);
    setScanIntervalHours(6);
    setExcludedPathsText(DEFAULT_EXCLUDED_PATHS.join(', '));
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 items-start">
      {/* Exclusion Rules & Album Naming Safeguards */}
      <section className="xl:col-span-2 rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
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
              placeholder="WhatsApp, Screenshots, Downloads, Memes"
              className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.09] bg-zinc-50/70 dark:bg-[#0A0C10] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
            />
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
              Assets whose file path contains any of these keywords are skipped during Stage 1 pre-filtering.
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

        <div className="pt-2 border-t border-zinc-100 dark:border-white/[0.06] text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
          <div className="flex justify-between">
            <span>Excluded keywords</span>
            <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {parsedPaths.length}
            </span>
          </div>
          <div className="flex justify-between">
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
