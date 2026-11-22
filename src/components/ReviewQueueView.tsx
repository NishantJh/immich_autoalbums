import {
  Check,
  CheckSquare,
  GitMerge,
  Pencil,
  RotateCcw,
  Scissors,
  Search,
  Square,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ClusterRecord } from '../shared/types.ts';
import { PaletteBar } from './PaletteBar.tsx';

interface ReviewQueueViewProps {
  clusters: ClusterRecord[];
  busyId: string | null;
  onRename: (id: string, title: string) => Promise<void>;
  onStatusChange: (id: string, status: 'pending' | 'approved' | 'discarded') => Promise<void>;
  onSyncOne: (id: string) => Promise<void>;
  onMerge: (ids: string[], title?: string) => Promise<void>;
  onSplit: (id: string, splitIndex: number) => Promise<void>;
  onOpenLibrary?: () => void;
}

type FilterTab = 'all' | 'pending' | 'trips' | 'local' | 'chapters' | 'synced' | 'discarded';

function formatDateSpan(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime())) return '';
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const sStr = fmt(s);
  const eStr = fmt(e);
  return sStr === eStr ? sStr : `${sStr} – ${eStr}`;
}

function clusterTypeLabel(type: ClusterRecord['clusterType']): string {
  if (type === 'trip') return 'Macro Trip';
  if (type === 'local_event') return 'Local Event';
  return 'Color-Tone Chapter';
}

function statusText(cluster: ClusterRecord): { label: string; className: string } {
  const hasNewPhotos =
    cluster.immichAlbumId !== null && cluster.assetIds.length > cluster.syncedAssetCount;

  if (hasNewPhotos) {
    const delta = cluster.assetIds.length - cluster.syncedAssetCount;
    return {
      label: `+${delta} new photos to append`,
      className: 'text-amber-700 dark:text-amber-400 font-medium',
    };
  }
  if (cluster.status === 'synced') {
    return { label: 'Synced', className: 'text-emerald-700 dark:text-emerald-400 font-medium' };
  }
  if (cluster.status === 'approved') {
    return { label: 'Approved for sync', className: 'text-indigo-700 dark:text-indigo-400 font-medium' };
  }
  if (cluster.status === 'discarded') {
    return { label: 'Discarded', className: 'text-neutral-500 dark:text-neutral-500' };
  }
  return { label: 'Awaiting review', className: 'text-neutral-600 dark:text-neutral-400' };
}

export function ReviewQueueView({
  clusters,
  busyId,
  onRename,
  onStatusChange,
  onSyncOne,
  onMerge,
  onSplit,
  onOpenLibrary,
}: ReviewQueueViewProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [mergeTitle, setMergeTitle] = useState('');
  const [inspectClusterId, setInspectClusterId] = useState<string | null>(null);

  const inspectedCluster = useMemo(
    () => clusters.find((c) => c.id === inspectClusterId) || null,
    [clusters, inspectClusterId]
  );

  const filteredClusters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clusters.filter((c) => {
      if (filter === 'all' && c.status === 'discarded') return false;
      if (filter === 'pending' && c.status !== 'pending' && c.status !== 'approved') return false;
      if (filter === 'trips' && c.clusterType !== 'trip') return false;
      if (filter === 'local' && c.clusterType !== 'local_event') return false;
      if (filter === 'chapters' && c.clusterType !== 'chapter') return false;
      if (filter === 'synced' && c.status !== 'synced') return false;
      if (filter === 'discarded' && c.status !== 'discarded') return false;

      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.locationLabel.toLowerCase().includes(q) ||
        c.moodLabel.toLowerCase().includes(q) ||
        (c.occasionLabel || '').toLowerCase().includes(q)
      );
    });
  }, [clusters, filter, query]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleStartRename = (cluster: ClusterRecord) => {
    setEditingId(cluster.id);
    setDraftTitle(cluster.title);
  };

  const handleCommitRename = async (id: string) => {
    if (draftTitle.trim()) {
      await onRename(id, draftTitle.trim());
    }
    setEditingId(null);
  };

  const handleMergeSubmit = async () => {
    if (selectedIds.length < 2) return;
    await onMerge(selectedIds, mergeTitle.trim() || undefined);
    setSelectedIds([]);
    setMergeTitle('');
  };

  const counts = useMemo(
    () => ({
      active: clusters.filter((c) => c.status !== 'discarded').length,
      pending: clusters.filter((c) => c.status === 'pending' || c.status === 'approved').length,
      trips: clusters.filter((c) => c.clusterType === 'trip' && c.status !== 'discarded').length,
      local: clusters.filter((c) => c.clusterType === 'local_event' && c.status !== 'discarded').length,
      chapters: clusters.filter((c) => c.clusterType === 'chapter' && c.status !== 'discarded').length,
      synced: clusters.filter((c) => c.status === 'synced').length,
      discarded: clusters.filter((c) => c.status === 'discarded').length,
    }),
    [clusters]
  );

  const tabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'all', label: 'All Active', count: counts.active },
    { key: 'pending', label: 'Needs Review', count: counts.pending },
    { key: 'trips', label: 'Trips', count: counts.trips },
    { key: 'local', label: 'Local Events', count: counts.local },
    { key: 'chapters', label: 'Color Chapters', count: counts.chapters },
    { key: 'synced', label: 'Synced', count: counts.synced },
    { key: 'discarded', label: 'Discarded', count: counts.discarded },
  ];

  return (
    <div className="space-y-6">
      {/* Toolbar: Segmented Filter Controls + Search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-neutral-100 dark:bg-neutral-900 p-1 border border-neutral-200/80 dark:border-neutral-800">
          {tabs.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  active
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                {tab.label} <span className="ml-1 opacity-60 font-mono">{tab.count}</span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full lg:w-72 shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, city, or mood..."
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] pl-9 pr-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Merge Selection Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/30 px-4 py-3">
          <div className="text-sm text-indigo-950 dark:text-indigo-200">
            <span className="font-semibold font-mono tabular-nums">{selectedIds.length}</span>{' '}
            {selectedIds.length === 1 ? 'cluster selected' : 'clusters selected for merge'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length >= 2 && (
              <>
                <input
                  type="text"
                  value={mergeTitle}
                  onChange={(e) => setMergeTitle(e.target.value)}
                  placeholder="Optional merged album title"
                  className="w-56 rounded-md border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-[#131722] px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={busyId === 'merge'}
                  onClick={handleMergeSubmit}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                  Merge Selected
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedIds([]);
                setMergeTitle('');
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Proposed Album Cards Grid */}
      {filteredClusters.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-12 text-center">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {clusters.length === 0
              ? 'No album proposals yet'
              : 'No album proposals match this filter'}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {clusters.length === 0
              ? 'Connect your Immich server or upload local photos in Library & Ingest, then click Run Scan.'
              : 'Try switching filter tabs, lowering the minimum photo threshold in Pipeline Lab, or uploading local photos.'}
          </p>
          {clusters.length === 0 && onOpenLibrary && (
            <button
              type="button"
              onClick={onOpenLibrary}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Open Library &amp; Ingest
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {filteredClusters.map((cluster) => {
            const isSelected = selectedIds.includes(cluster.id);
            const isEditing = editingId === cluster.id;
            const isBusy = busyId === cluster.id;
            const previewAssets = (cluster.assets || []).slice(0, 4);
            const st = statusText(cluster);
            const hasPendingAppend =
              cluster.immichAlbumId !== null && cluster.assetIds.length > cluster.syncedAssetCount;

            return (
              <article
                key={cluster.id}
                className={`flex flex-col rounded-xl border bg-white dark:bg-[#131722] overflow-hidden transition-colors ${
                  isSelected
                    ? 'border-indigo-500 ring-1 ring-indigo-500/40'
                    : 'border-neutral-200 dark:border-neutral-800'
                }`}
              >
                {/* 4-Photo Thumbnail Mosaic Strip */}
                <div className="relative grid grid-cols-4 gap-0.5 bg-neutral-100 dark:bg-neutral-900 h-40">
                  {previewAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="relative h-full w-full overflow-hidden bg-neutral-200 dark:bg-neutral-800"
                    >
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.fileName}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                  {previewAssets.length < 4 &&
                    Array.from({ length: 4 - previewAssets.length }).map((_, i) => (
                      <div
                        key={`empty-${i}`}
                        className="h-full w-full bg-neutral-100 dark:bg-neutral-900"
                      />
                    ))}

                  {/* Measured dark scrim at top-left for selection checkbox only */}
                  <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => toggleSelect(cluster.id)}
                    aria-label={`Select ${cluster.title} for merge`}
                    className="absolute left-3 top-3 inline-flex items-center gap-1.5 text-xs font-medium text-white/95 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-indigo-300" />
                    ) : (
                      <Square className="h-4 w-4 text-white/80" />
                    )}
                    <span className="sr-only">Select</span>
                  </button>

                  {/* Bottom scrim with photo count & LAB mean */}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3.5 py-2 text-[11px] font-mono tabular-nums text-white/95">
                    <span>{cluster.assetIds.length} photos</span>
                    <span>
                      L*{cluster.avgLab.l.toFixed(0)} · a*{cluster.avgLab.a >= 0 ? '+' : ''}
                      {cluster.avgLab.a.toFixed(0)} · b*{cluster.avgLab.b >= 0 ? '+' : ''}
                      {cluster.avgLab.b.toFixed(0)}
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col p-5">
                  {/* Extracted 5-Color CIELAB Palette Bar */}
                  <div className="mb-4">
                    <PaletteBar swatches={cluster.palette} heightClass="h-3" interactive />
                  </div>

                  {/* Quiet 1-line kicker metadata (Zero-Pill Discipline) */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      {clusterTypeLabel(cluster.clusterType)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{cluster.moodLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className={st.className}>{st.label}</span>
                  </div>

                  {/* Editable Album Title */}
                  <div className="mt-1.5">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommitRename(cluster.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          className="flex-1 rounded-md border border-indigo-500 bg-white dark:bg-[#0B0E14] px-2.5 py-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleCommitRename(cluster.id)}
                          className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 whitespace-nowrap shrink-0"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-md px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
                          aria-label="Cancel rename"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="group flex items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 leading-snug">
                          {cluster.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleStartRename(cluster)}
                          title="Rename album"
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 transition-colors shrink-0"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Location, Date Range, Hash Metadata */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>{cluster.locationLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {formatDateSpan(cluster.startDate, cluster.endDate)}
                    </span>
                    {cluster.emdBoundaryScore > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          EMD {cluster.emdBoundaryScore.toFixed(2)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Action Footer */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 dark:border-neutral-800/80 pt-3.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInspectClusterId(cluster.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                        Inspect &amp; Split
                      </button>

                      {cluster.status === 'discarded' ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onStatusChange(cluster.id, 'pending')}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onStatusChange(cluster.id, 'discarded')}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Discard
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {cluster.status === 'pending' && !hasPendingAppend && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onStatusChange(cluster.id, 'approved')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/70 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </button>
                      )}

                      {cluster.status !== 'discarded' && (
                        <button
                          type="button"
                          disabled={isBusy || (cluster.status === 'synced' && !hasPendingAppend)}
                          onClick={() => onSyncOne(cluster.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            cluster.status === 'synced' && !hasPendingAppend
                              ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 cursor-default'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                          }`}
                        >
                          <UploadCloud className="h-3.5 w-3.5" />
                          {isBusy
                            ? 'Syncing...'
                            : hasPendingAppend
                              ? `Append +${cluster.assetIds.length - cluster.syncedAssetCount}`
                              : cluster.status === 'synced'
                                ? 'Synced'
                                : 'Sync to Immich'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Inspect & Manual Split Modal Drawer */}
      {inspectedCluster && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[1px]"
          onClick={() => setInspectClusterId(null)}
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col bg-white dark:bg-[#0F131D] border-l border-neutral-200 dark:border-neutral-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {clusterTypeLabel(inspectedCluster.clusterType)} · {inspectedCluster.moodLabel} ·{' '}
                  <span className="font-mono">{inspectedCluster.clusterHash}</span>
                </p>
                <h2 className="mt-0.5 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {inspectedCluster.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectClusterId(null)}
                aria-label="Close inspector"
                className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 bg-neutral-50/70 dark:bg-[#131722]">
              <div className="mb-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>Cluster 5-color CIELAB palette (hover or click any swatch)</span>
                <span className="font-mono tabular-nums">
                  {inspectedCluster.assetIds.length} frames
                </span>
              </div>
              <PaletteBar swatches={inspectedCluster.palette} heightClass="h-4" interactive />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                Frames ordered chronologically. Click <strong className="text-neutral-800 dark:text-neutral-200">Split here</strong> between any two photos to divide this cluster into two separate Immich albums.
              </p>

              <div className="space-y-2">
                {(inspectedCluster.assets || []).map((asset, idx) => (
                  <div key={asset.id}>
                    {idx > 0 && (
                      <div className="my-2 flex items-center gap-3">
                        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                        <button
                          type="button"
                          disabled={busyId === inspectedCluster.id}
                          onClick={async () => {
                            await onSplit(inspectedCluster.id, idx);
                            setInspectClusterId(null);
                          }}
                          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300 transition-colors whitespace-nowrap"
                        >
                          <Scissors className="h-3 w-3" />
                          Split here ({idx} / {(inspectedCluster.assets || []).length - idx})
                        </button>
                        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                      </div>
                    )}

                    <div className="flex items-center gap-3.5 rounded-lg border border-neutral-200/80 dark:border-neutral-800/80 p-2.5">
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.fileName}
                        referrerPolicy="no-referrer"
                        className="h-14 w-20 rounded object-cover bg-neutral-100 dark:bg-neutral-900 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {asset.fileName}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400 shrink-0">
                            {new Date(asset.localDateTime).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'UTC',
                            })}{' '}
                            UTC
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500 dark:text-neutral-400">
                          <span>
                            {asset.exifMake && asset.exifModel
                              ? `${asset.exifMake} ${asset.exifModel}`
                              : 'No camera EXIF'}
                          </span>
                          {asset.avgLab && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                L*{asset.avgLab.l.toFixed(0)} a*{asset.avgLab.a.toFixed(0)} b*
                                {asset.avgLab.b.toFixed(0)}
                              </span>
                            </>
                          )}
                          {asset.smartTags.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{asset.smartTags.slice(0, 3).join(', ')}</span>
                            </>
                          )}
                        </div>
                        <div className="mt-2 max-w-[200px]">
                          <PaletteBar swatches={asset.palette} heightClass="h-1.5" interactive={false} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
