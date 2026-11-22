import { GitBranch, Loader2, Play, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OrganizerSettings, PipelineRunSummary } from '../shared/types.ts';
import { EmdChart } from './EmdChart.tsx';

interface PipelineLabViewProps {
  summary: PipelineRunSummary | null;
  settings: OrganizerSettings;
  isRunning: boolean;
  onApplyAndRun: (partial: Partial<OrganizerSettings>) => Promise<void>;
  onClearCacheAndRun: () => Promise<void>;
  onOpenRules: () => void;
}

export function PipelineLabView({
  summary,
  settings,
  isRunning,
  onApplyAndRun,
  onClearCacheAndRun,
  onOpenRules,
}: PipelineLabViewProps) {
  const [homeRadiusKm, setHomeRadiusKm] = useState(settings.homeRadiusKm);
  const [tripGapHours, setTripGapHours] = useState(settings.tripGapHours);
  const [sceneSplitGapMins, setSceneSplitGapMins] = useState(settings.sceneSplitGapMins);
  const [emdThreshold, setEmdThreshold] = useState(settings.emdThreshold);
  const [minPhotosPerAlbum, setMinPhotosPerAlbum] = useState(settings.minPhotosPerAlbum);
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  useEffect(() => {
    setHomeRadiusKm(settings.homeRadiusKm);
    setTripGapHours(settings.tripGapHours);
    setSceneSplitGapMins(settings.sceneSplitGapMins);
    setEmdThreshold(settings.emdThreshold);
    setMinPhotosPerAlbum(settings.minPhotosPerAlbum);
  }, [settings]);

  useEffect(() => {
    if (summary && summary.eventTimelines.length > 0) {
      const exists = summary.eventTimelines.some((e) => e.eventId === selectedEventId);
      if (!exists) {
        setSelectedEventId(summary.eventTimelines[0].eventId);
      }
    }
  }, [summary, selectedEventId]);

  const activeTimeline =
    summary?.eventTimelines.find((e) => e.eventId === selectedEventId) ||
    summary?.eventTimelines[0] ||
    null;

  const isDirty =
    homeRadiusKm !== settings.homeRadiusKm ||
    tripGapHours !== settings.tripGapHours ||
    sceneSplitGapMins !== settings.sceneSplitGapMins ||
    emdThreshold !== settings.emdThreshold ||
    minPhotosPerAlbum !== settings.minPhotosPerAlbum;

  const homeBaseLabel =
    summary && summary.stage2.homeBaseCity && summary.stage2.homeBaseCity !== '—'
      ? summary.stage2.homeBaseSource === 'disabled'
        ? 'Disabled'
        : summary.stage2.homeBaseCountry &&
            summary.stage2.homeBaseCountry !== summary.stage2.homeBaseCity
          ? `${summary.stage2.homeBaseCity}, ${summary.stage2.homeBaseCountry}`
          : summary.stage2.homeBaseCity
      : 'Not inferred';

  const moodEntries = summary ? Object.entries(summary.stage3.moodDistribution).slice(0, 4) : [];

  return (
    <div className="space-y-6">
      {/* 4-Stage Pipeline Summary Ledger */}
      {summary && (
        <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-white/[0.07] px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Four-Stage Clustering &amp; Color-Tone Execution
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                Last run {new Date(summary.runAt).toLocaleString()} · Completed in{' '}
                {summary.durationMs} ms
              </p>
            </div>

            <button
              type="button"
              disabled={isRunning}
              onClick={onClearCacheAndRun}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.05] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              Clear LAB Cache &amp; Re-Extract
            </button>
          </div>

          <div className="grid grid-cols-1 divide-y divide-zinc-200/80 dark:divide-white/[0.07] md:grid-cols-2 lg:grid-cols-4 lg:divide-y-0 lg:divide-x">
            {/* Stage 1 */}
            <div className="p-5 space-y-3">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                01. Pre-Filter &amp; Feature Cache
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                {summary.stage1.eligibleAssets}{' '}
                <span className="text-xs font-sans font-normal text-zinc-500 dark:text-zinc-400">
                  / {summary.stage1.totalAssets} eligible
                </span>
              </div>
              <dl className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="flex justify-between gap-2">
                  <dt>
                    Screenshots filtered{!settings.ignoreScreenshots ? ' (off)' : ''}
                  </dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage1.excludedScreenshots}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Path rule exclusions</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage1.excludedByPathRule}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Archived / albumed</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage1.excludedArchivedOrTrashed +
                      summary.stage1.excludedAlreadyAlbumed}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 pt-1.5 border-t border-zinc-100 dark:border-white/[0.06]">
                  <dt>SQLite cache hits / new</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage1.cacheHits} / {summary.stage1.newlyExtracted}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stage 2 */}
            <div className="p-5 space-y-3">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                02. Multi-Signal Event Fusion
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                {summary.stage2.macroTripCount + summary.stage2.localEventCount}{' '}
                <span className="text-xs font-sans font-normal text-zinc-500 dark:text-zinc-400">
                  events
                </span>
              </div>
              <dl className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="flex justify-between gap-2">
                  <dt className="flex items-center gap-1.5">
                    <span>
                      {summary.stage2.homeBaseSource === 'manual'
                        ? 'Manual home base'
                        : summary.stage2.homeBaseSource === 'disabled'
                          ? 'Home base'
                          : 'Inferred home base'}
                    </span>
                    <button
                      type="button"
                      onClick={onOpenRules}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Edit
                    </button>
                  </dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-200 truncate text-right">
                    {homeBaseLabel}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Trips / local events</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage2.macroTripCount} / {summary.stage2.localEventCount}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>GPS / Immich ML / Faces</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage2.gpsTaggedCount ?? 0} / {summary.stage2.mlTaggedCount ?? 0} /{' '}
                    {summary.stage2.faceTaggedCount ?? 0}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 pt-1.5 border-t border-zinc-100 dark:border-white/[0.06]">
                  <dt>Bridged DSLR / noise</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage2.bridgedNoGpsCount ?? 0} / {summary.stage2.unclusteredNoiseCount}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stage 3 */}
            <div className="p-5 space-y-3">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                03. Chroma + ML Scene Split
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                {summary.stage3.sceneSplitsDetected}{' '}
                <span className="text-xs font-sans font-normal text-zinc-500 dark:text-zinc-400">
                  scene splits
                </span>
              </div>
              <dl className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="flex justify-between gap-2">
                  <dt>Events evaluated</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage3.eventsEvaluated}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Sub-chapters created</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    {summary.stage3.totalChaptersCreated}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Fusion split threshold</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    &ge; {settings.emdThreshold.toFixed(2)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 pt-1.5 border-t border-zinc-100 dark:border-white/[0.06]">
                  <dt>Time gap requirement</dt>
                  <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                    &ge; {settings.sceneSplitGapMins} min
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stage 4 */}
            <div className="p-5 space-y-3">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                04. Semantic Flat-Album Naming
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                {summary.totalProposedAlbums}{' '}
                <span className="text-xs font-sans font-normal text-zinc-500 dark:text-zinc-400">
                  proposed albums
                </span>
              </div>
              {moodEntries.length > 0 ? (
                <div className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                  {moodEntries.map(([mood, cnt]) => (
                    <div key={mood} className="flex justify-between gap-2">
                      <span className="truncate">{mood}</span>
                      <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-200">
                        {cnt}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No color moods classified yet. Run a scan after indexing photos.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Interactive CIELAB EMD Chart Section */}
      <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] p-6">
        {(summary?.eventTimelines || []).length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-100/80 dark:bg-[#0D1017] p-1">
              {(summary?.eventTimelines || []).map((evt) => {
                const active = activeTimeline?.eventId === evt.eventId;
                return (
                  <button
                    key={evt.eventId}
                    type="button"
                    onClick={() => setSelectedEventId(evt.eventId)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white dark:bg-[#1B202C] text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {evt.eventName}{' '}
                    <span className="ml-1 font-mono text-[11px] opacity-60">
                      ({evt.chapterCount} ch)
                    </span>
                  </button>
                );
              })}
            </div>
            {activeTimeline && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                {activeTimeline.locationLabel} · {activeTimeline.photoCount} frames ·{' '}
                {activeTimeline.clusterType === 'trip' ? 'Macro Trip' : 'Local Home-City Event'}
              </div>
            )}
          </div>
        )}

        {activeTimeline ? (
          <EmdChart
            points={activeTimeline.points}
            emdThreshold={settings.emdThreshold}
            sceneSplitGapMins={settings.sceneSplitGapMins}
            eventName={activeTimeline.eventName}
          />
        ) : (
          <div className="py-12 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#171B24] text-zinc-500 dark:text-zinc-400">
              <GitBranch className="h-4 w-4" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No event timelines to analyze yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Index photos from Immich or upload local JPEGs, then run the pipeline to inspect sliding-window CIELAB EMD curves.
            </p>
          </div>
        )}
      </section>

      {/* Calibration Controls */}
      <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200/80 dark:border-white/[0.07] pb-4">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Pipeline Threshold Calibration
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Adjust spatiotemporal &amp; CIELAB EMD sensitivity, then re-run incrementally from the SQLite feature cache.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={() =>
              onApplyAndRun({
                homeRadiusKm,
                tripGapHours,
                sceneSplitGapMins,
                emdThreshold,
                minPhotosPerAlbum,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isRunning
              ? 'Running...'
              : isDirty
                ? 'Save & Re-Run Pipeline'
                : 'Re-Run Pipeline'}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
          <label className="block space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Home Radius</span>
              <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {homeRadiusKm.toFixed(1)} km
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              step={0.5}
              value={homeRadiusKm}
              onChange={(e) => setHomeRadiusKm(Number(e.target.value))}
              className="studio-slider w-full"
            />
            <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Geohash radius distinguishing home vs trips
            </span>
          </label>

          <label className="block space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Trip Merge Gap</span>
              <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {tripGapHours} hrs
              </span>
            </div>
            <input
              type="range"
              min={12}
              max={72}
              step={2}
              value={tripGapHours}
              onChange={(e) => setTripGapHours(Number(e.target.value))}
              className="studio-slider w-full"
            />
            <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Max hours between consecutive trip days
            </span>
          </label>

          <label className="block space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Scene Split Gap</span>
              <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {sceneSplitGapMins} min
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={sceneSplitGapMins}
              onChange={(e) => setSceneSplitGapMins(Number(e.target.value))}
              className="studio-slider w-full"
            />
            <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Minimum time break for a color-tone split
            </span>
          </label>

          <label className="block space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">EMD Sensitivity</span>
              <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {emdThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.15}
              max={0.75}
              step={0.02}
              value={emdThreshold}
              onChange={(e) => setEmdThreshold(Number(e.target.value))}
              className="studio-slider w-full"
            />
            <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Lower = more visual chapter splits
            </span>
          </label>

          <label className="block space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Min Photos</span>
              <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                &ge; {minPhotosPerAlbum}
              </span>
            </div>
            <input
              type="range"
              min={3}
              max={20}
              step={1}
              value={minPhotosPerAlbum}
              onChange={(e) => setMinPhotosPerAlbum(Number(e.target.value))}
              className="studio-slider w-full"
            />
            <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Minimum frames required to propose an album
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
