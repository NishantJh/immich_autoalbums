import { Play, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OrganizerSettings, PipelineRunSummary } from '../shared/types.ts';
import { EmdChart } from './EmdChart.tsx';

interface PipelineLabViewProps {
  summary: PipelineRunSummary | null;
  settings: OrganizerSettings;
  isRunning: boolean;
  onApplyAndRun: (partial: Partial<OrganizerSettings>) => Promise<void>;
  onClearCacheAndRun: () => Promise<void>;
}

export function PipelineLabView({
  summary,
  settings,
  isRunning,
  onApplyAndRun,
  onClearCacheAndRun,
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

  return (
    <div className="space-y-6">
      {/* 4-Stage Pipeline Summary Ledger (Single Elevation, Hairline Dividers) */}
      {summary && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Four-Stage Clustering &amp; Color-Tone Execution
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                Last run {new Date(summary.runAt).toLocaleString()} · Completed in{' '}
                {summary.durationMs} ms
              </p>
            </div>

            <button
              type="button"
              disabled={isRunning}
              onClick={onClearCacheAndRun}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              Clear LAB Cache &amp; Re-Extract
            </button>
          </div>

          <div className="grid grid-cols-1 divide-y divide-neutral-200 dark:divide-neutral-800 md:grid-cols-2 lg:grid-cols-4 lg:divide-y-0 lg:divide-x">
            {/* Stage 1 */}
            <div className="p-5 space-y-2.5">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                01. Pre-Filter &amp; Feature Cache
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                {summary.stage1.eligibleAssets}{' '}
                <span className="text-xs font-sans font-normal text-neutral-500">
                  / {summary.stage1.totalAssets} eligible
                </span>
              </div>
              <dl className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                <div className="flex justify-between">
                  <dt>Screenshots filtered</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage1.excludedScreenshots}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Path rule exclusions</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage1.excludedByPathRule}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Archived / albumed</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage1.excludedArchivedOrTrashed + summary.stage1.excludedAlreadyAlbumed}
                  </dd>
                </div>
                <div className="flex justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800/80">
                  <dt>SQLite cache hits / new</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage1.cacheHits} / {summary.stage1.newlyExtracted}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stage 2 */}
            <div className="p-5 space-y-2.5">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                02. Spatiotemporal Grouping
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                {summary.stage2.macroTripCount + summary.stage2.localEventCount}{' '}
                <span className="text-xs font-sans font-normal text-neutral-500">events</span>
              </div>
              <dl className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                <div className="flex justify-between">
                  <dt>Inferred home base</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-200">
                    {summary.stage2.homeBaseCity} ({summary.stage2.homeBaseGeohash})
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Macro trips (&gt;{settings.homeRadiusKm} km)</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage2.macroTripCount}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Local home-city events</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage2.localEventCount}
                  </dd>
                </div>
                <div className="flex justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800/80">
                  <dt>Household faces / noise</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage2.householdPeopleIds.length} / {summary.stage2.unclusteredNoiseCount}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stage 3 */}
            <div className="p-5 space-y-2.5">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                03. CIELAB Color-Tone Split
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                {summary.stage3.sceneSplitsDetected}{' '}
                <span className="text-xs font-sans font-normal text-neutral-500">
                  scene splits
                </span>
              </div>
              <dl className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                <div className="flex justify-between">
                  <dt>Events evaluated</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage3.eventsEvaluated}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Sub-chapters created</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    {summary.stage3.totalChaptersCreated}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>EMD split threshold</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    &ge; {settings.emdThreshold.toFixed(2)}
                  </dd>
                </div>
                <div className="flex justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800/80">
                  <dt>Time gap requirement</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                    &ge; {settings.sceneSplitGapMins} min
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stage 4 */}
            <div className="p-5 space-y-2.5">
              <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                04. Semantic Flat-Album Naming
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                {summary.totalProposedAlbums}{' '}
                <span className="text-xs font-sans font-normal text-neutral-500">
                  proposed albums
                </span>
              </div>
              <div className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                {Object.entries(summary.stage3.moodDistribution)
                  .slice(0, 4)
                  .map(([mood, cnt]) => (
                    <div key={mood} className="flex justify-between">
                      <span>{mood}</span>
                      <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-200">
                        {cnt}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Interactive CIELAB EMD Chart Section */}
      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-neutral-100 dark:bg-neutral-900 p-1 border border-neutral-200/80 dark:border-neutral-800">
            {(summary?.eventTimelines || []).map((evt) => {
              const active = activeTimeline?.eventId === evt.eventId;
              return (
                <button
                  key={evt.eventId}
                  type="button"
                  onClick={() => setSelectedEventId(evt.eventId)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                  }`}
                >
                  {evt.eventName}{' '}
                  <span className="ml-1 font-mono text-[11px] opacity-65">
                    ({evt.chapterCount} ch)
                  </span>
                </button>
              );
            })}
          </div>
          {activeTimeline && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
              {activeTimeline.locationLabel} · {activeTimeline.photoCount} frames ·{' '}
              {activeTimeline.clusterType === 'trip' ? 'Macro Trip' : 'Local Home-City Event'}
            </div>
          )}
        </div>

        {activeTimeline ? (
          <EmdChart
            points={activeTimeline.points}
            emdThreshold={settings.emdThreshold}
            sceneSplitGapMins={settings.sceneSplitGapMins}
            eventName={activeTimeline.eventName}
          />
        ) : (
          <div className="py-10 text-center text-sm text-neutral-500">
            Run the pipeline to compute sliding-window CIELAB EMD timelines.
          </div>
        )}
      </section>

      {/* Calibration Controls */}
      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Pipeline Threshold Calibration
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" />
            {isDirty ? 'Save & Re-Run Pipeline' : 'Re-Run Pipeline'}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
          <label className="block space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Home Radius</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
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
              className="w-full accent-indigo-600"
            />
            <span className="block text-[11px] text-neutral-500">
              Geohash radius distinguishing home vs trips
            </span>
          </label>

          <label className="block space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Trip Merge Gap</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
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
              className="w-full accent-indigo-600"
            />
            <span className="block text-[11px] text-neutral-500">
              Max hours between consecutive trip days
            </span>
          </label>

          <label className="block space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Scene Split Gap</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
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
              className="w-full accent-indigo-600"
            />
            <span className="block text-[11px] text-neutral-500">
              Minimum time break for a color-tone split
            </span>
          </label>

          <label className="block space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">EMD Sensitivity</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
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
              className="w-full accent-indigo-600"
            />
            <span className="block text-[11px] text-neutral-500">
              Lower = more visual chapter splits
            </span>
          </label>

          <label className="block space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Min Photos</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
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
              className="w-full accent-indigo-600"
            />
            <span className="block text-[11px] text-neutral-500">
              Minimum frames required to propose an album
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
