import {
  ArrowRight,
  Check,
  CheckSquare,
  Clock,
  FolderKanban,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClusterRecord, RenameSuggestion } from '../shared/types.ts';
import { PaletteBar } from './PaletteBar.tsx';
import { ThumbnailImage } from './ThumbnailImage.tsx';

interface ReviewQueueViewProps {
  clusters: ClusterRecord[];
  busyId: string | null;
  onRename: (
    id: string,
    title: string,
    timelineWindowDays?: number
  ) => Promise<{
    renameSuggestions: RenameSuggestion[];
    renamedCluster?: { id: string; oldTitle: string; newTitle: string };
  }>;
  onFetchRenameSuggestions: (
    id: string,
    oldTitle: string,
    newTitle: string,
    timelineWindowDays: number
  ) => Promise<RenameSuggestion[]>;
  onBatchRename: (updates: Array<{ id: string; title: string }>) => Promise<boolean>;
  onStatusChange: (id: string, status: 'pending' | 'approved' | 'discarded') => Promise<void>;
  onSyncOne: (id: string) => Promise<void>;
  onMerge: (ids: string[], title?: string, keepOriginals?: boolean) => Promise<void>;
  onSplit: (id: string, splitIndex: number) => Promise<void>;
  onOpenLibrary?: () => void;
}

type FilterTab = 'all' | 'pending' | 'trips' | 'local' | 'chapters' | 'synced' | 'discarded';

function formatDateSpan(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime())) return '';
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
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
      label: `+${delta} new to append`,
      className: 'text-amber-700 dark:text-amber-400 font-medium',
    };
  }
  if (cluster.status === 'synced') {
    return { label: 'Synced', className: 'text-emerald-700 dark:text-emerald-400 font-medium' };
  }
  if (cluster.status === 'approved') {
    return { label: 'Approved', className: 'text-indigo-600 dark:text-indigo-400 font-medium' };
  }
  if (cluster.status === 'discarded') {
    return { label: 'Discarded', className: 'text-zinc-500 dark:text-zinc-500' };
  }
  return { label: 'Awaiting review', className: 'text-zinc-600 dark:text-zinc-400' };
}

export function ReviewQueueView({
  clusters,
  busyId,
  onRename,
  onFetchRenameSuggestions,
  onBatchRename,
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
  const [keepOriginalsOnMerge, setKeepOriginalsOnMerge] = useState(false);
  const [inspectClusterId, setInspectClusterId] = useState<string | null>(null);

  // Timeline-nearby rename propagation session
  const [renameSession, setRenameSession] = useState<{
    sourceId: string;
    oldTitle: string;
    newTitle: string;
    windowDays: number;
    suggestions: RenameSuggestion[];
  } | null>(null);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, string>>({});
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const suggestionCardRef = useRef<HTMLDivElement | null>(null);

  const inspectedCluster = useMemo(
    () => clusters.find((c) => c.id === inspectClusterId) || null,
    [clusters, inspectClusterId]
  );

  useEffect(() => {
    if (!inspectClusterId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectClusterId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectClusterId]);

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
        (c.occasionLabel || '').toLowerCase().includes(q) ||
        (c.signalBreakdown?.namedPeople || []).some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [clusters, filter, query]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const applySuggestionList = (
    sourceId: string,
    oldTitle: string,
    newTitle: string,
    windowDays: number,
    suggestions: RenameSuggestion[]
  ) => {
    setRenameSession({ sourceId, oldTitle, newTitle, windowDays, suggestions });
    setSelectedSuggestionIds(
      suggestions.filter((s) => s.selectedByDefault).map((s) => s.clusterId)
    );
    const drafts: Record<string, string> = {};
    for (const s of suggestions) {
      drafts[s.clusterId] = s.suggestedTitle;
    }
    setSuggestionDrafts(drafts);
  };

  const handleStartRename = (cluster: ClusterRecord) => {
    setEditingId(cluster.id);
    setDraftTitle(cluster.title);
  };

  const handleCommitRename = async (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      const defaultWindow = renameSession?.windowDays ?? 14;
      const result = await onRename(id, trimmed, defaultWindow);
      if (result.renamedCluster && result.renameSuggestions.length > 0) {
        applySuggestionList(
          result.renamedCluster.id,
          result.renamedCluster.oldTitle,
          result.renamedCluster.newTitle,
          defaultWindow,
          result.renameSuggestions
        );
        requestAnimationFrame(() => {
          suggestionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    }
    setEditingId(null);
  };

  const handleChangeSuggestionWindow = async (nextDays: number) => {
    if (!renameSession || nextDays === renameSession.windowDays) return;
    setRefreshingSuggestions(true);
    try {
      const next = await onFetchRenameSuggestions(
        renameSession.sourceId,
        renameSession.oldTitle,
        renameSession.newTitle,
        nextDays
      );
      applySuggestionList(
        renameSession.sourceId,
        renameSession.oldTitle,
        renameSession.newTitle,
        nextDays,
        next
      );
    } finally {
      setRefreshingSuggestions(false);
    }
  };

  const toggleSuggestion = (clusterId: string) => {
    setSelectedSuggestionIds((prev) =>
      prev.includes(clusterId) ? prev.filter((x) => x !== clusterId) : [...prev, clusterId]
    );
  };

  const handleApplySuggestions = async () => {
    if (!renameSession || selectedSuggestionIds.length === 0) return;
    const updates = selectedSuggestionIds
      .map((cid) => ({
        id: cid,
        title: (suggestionDrafts[cid] || '').trim(),
      }))
      .filter((u) => u.title.length > 0);
    if (updates.length === 0) return;
    const ok = await onBatchRename(updates);
    if (ok) {
      setRenameSession(null);
      setSelectedSuggestionIds([]);
      setSuggestionDrafts({});
    }
  };

  // Detect groups of 2+ active albums that share the same event / place base (e.g. 13 Kalimpong Trip albums)
  const mergeableGroups = useMemo(() => {
    const active = clusters.filter((c) => c.status !== 'discarded');
    const normalizeBase = (c: ClusterRecord): { key: string; label: string } => {
      const stripped = c.title
        .replace(/^\d{4}-\d{2}\s*[•·-]\s*/, '')
        .replace(/\s+—\s+.+$/, '')
        .replace(/\s*\(All\)$/i, '')
        .replace(/\s*\(Merged\)$/i, '')
        .replace(/\s+#\d+$/, '')
        .replace(/\s+Part\s+\d+$/i, '')
        .trim();
      const base = (c.parentEventName || stripped || c.locationLabel || 'Untitled').trim();
      const ym = (c.startDate || '').slice(0, 7);
      return {
        key: `${ym}::${base.toLowerCase()}`,
        label: base,
      };
    };

    const byKey = new Map<
      string,
      { key: string; label: string; ym: string; clusters: ClusterRecord[]; uniquePhotos: number }
    >();
    for (const c of active) {
      const { key, label } = normalizeBase(c);
      const existing = byKey.get(key);
      if (existing) {
        existing.clusters.push(c);
      } else {
        byKey.set(key, {
          key,
          label,
          ym: (c.startDate || '').slice(0, 7),
          clusters: [c],
          uniquePhotos: 0,
        });
      }
    }

    return Array.from(byKey.values())
      .filter((g) => g.clusters.length >= 2)
      .map((g) => {
        const photoSet = new Set<string>();
        for (const c of g.clusters) {
          for (const aid of c.assetIds) photoSet.add(aid);
        }
        return { ...g, uniquePhotos: photoSet.size };
      })
      .sort((a, b) => b.clusters.length - a.clusters.length || b.uniquePhotos - a.uniquePhotos)
      .slice(0, 6);
  }, [clusters]);

  const selectedClusters = useMemo(
    () => clusters.filter((c) => selectedIds.includes(c.id)),
    [clusters, selectedIds]
  );

  const selectedUniquePhotoCount = useMemo(() => {
    const set = new Set<string>();
    for (const c of selectedClusters) {
      for (const id of c.assetIds) set.add(id);
    }
    return set.size;
  }, [selectedClusters]);

  const suggestedMergeTitle = useMemo(() => {
    if (selectedClusters.length < 2) return '';
    const sorted = [...selectedClusters].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    const strip = (t: string) =>
      t
        .replace(/\s+—\s+.+$/, '')
        .replace(/\s*\(All\)$/i, '')
        .replace(/\s*\(Merged\)$/i, '')
        .replace(/\s+#\d+$/, '')
        .trim();
    const first = strip(sorted[0].title);
    const allSame = sorted.every((c) => strip(c.title).toLowerCase() === first.toLowerCase());
    return allSame && first ? first : `${first} (Merged)`;
  }, [selectedClusters]);

  const handleSelectGroup = (groupClusters: ClusterRecord[], suggestedTitle: string) => {
    setSelectedIds(groupClusters.map((c) => c.id));
    setMergeTitle(suggestedTitle);
    setKeepOriginalsOnMerge(false);
  };

  const handleSelectAllFiltered = () => {
    const activeFiltered = filteredClusters.filter((c) => c.status !== 'discarded');
    setSelectedIds(activeFiltered.map((c) => c.id));
  };

  const handleMergeSubmit = async () => {
    if (selectedIds.length < 2) return;
    await onMerge(selectedIds, mergeTitle.trim() || undefined, keepOriginalsOnMerge);
    setSelectedIds([]);
    setMergeTitle('');
    setKeepOriginalsOnMerge(false);
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
    { key: 'chapters', label: 'Chapters', count: counts.chapters },
    { key: 'synced', label: 'Synced', count: counts.synced },
    { key: 'discarded', label: 'Discarded', count: counts.discarded },
  ];

  return (
    <div className="space-y-6">
      {/* Toolbar: Segmented Filter Controls + Search */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-100/80 dark:bg-[#11141B] p-1">
          {tabs.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? 'bg-white dark:bg-[#1B202C] text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}{' '}
                <span className="ml-1 font-mono text-[11px] opacity-60">{tab.count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 w-full xl:w-auto shrink-0">
          <div className="relative flex-1 xl:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, city, person, or mood..."
              className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] pl-9 pr-8 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {filteredClusters.filter((c) => c.status !== 'discarded').length >= 2 && (
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.05] transition-colors whitespace-nowrap shrink-0 tabular-nums"
              title="Select all visible albums to merge them"
            >
              <GitMerge className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Select {filteredClusters.filter((c) => c.status !== 'discarded').length}
            </button>
          )}
        </div>
      </div>

      {/* Quick Merge Suggestions for Split / Related Album Groups (e.g. 13 Kalimpong Trip albums) */}
      {mergeableGroups.length > 0 && selectedIds.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 mr-1">
            <GitMerge className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>Merge related albums:</span>
          </div>
          {mergeableGroups.map((group) => {
            const defaultTitle = group.ym ? `${group.ym} • ${group.label}` : group.label;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => handleSelectGroup(group.clusters, defaultTitle)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/90 dark:border-white/[0.10] bg-zinc-50 dark:bg-[#171B24] px-2.5 py-1 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:border-indigo-400 dark:hover:border-indigo-500/60 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
              >
                <span className="truncate max-w-[180px]">{group.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-indigo-600 dark:text-indigo-400">
                  {group.clusters.length} albums
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Timeline-Nearby Rename Suggestions Panel */}
      {renameSession && (
        <div
          ref={suggestionCardRef}
          className="rounded-xl border border-indigo-200/90 dark:border-indigo-500/30 bg-white dark:bg-[#11141B] overflow-hidden"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200/80 dark:border-white/[0.07] bg-indigo-50/50 dark:bg-indigo-950/25 px-5 py-3.5">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Apply rename to nearby albums?</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap items-center gap-1.5">
                <span className="line-through opacity-75">{renameSession.oldTitle}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-indigo-500" />
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {renameSession.newTitle}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div
                className="flex items-center gap-0.5 rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0D1017] p-0.5"
                aria-label="Timeline proximity window"
              >
                {[3, 14, 30, 90].map((days) => {
                  const active = renameSession.windowDays === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      disabled={refreshingSuggestions}
                      onClick={() => void handleChangeSuggestionWindow(days)}
                      className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded-md transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-indigo-600 text-white'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      ±{days}d
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setRenameSession(null);
                  setSelectedSuggestionIds([]);
                }}
                aria-label="Dismiss rename suggestions"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {renameSession.suggestions.length === 0 ? (
            <div className="px-5 py-4 text-xs text-zinc-500 dark:text-zinc-400">
              No matching albums found within ±{renameSession.windowDays} days. Try widening the timeline window above.
            </div>
          ) : (
            <>
              <div className="divide-y divide-zinc-100 dark:divide-white/[0.06] max-h-72 overflow-y-auto">
                {renameSession.suggestions.map((item) => {
                  const checked = selectedSuggestionIds.includes(item.clusterId);
                  const draft = suggestionDrafts[item.clusterId] ?? item.suggestedTitle;
                  return (
                    <div
                      key={item.clusterId}
                      className={`flex flex-col gap-2.5 px-5 py-3 sm:flex-row sm:items-center sm:gap-4 transition-colors ${
                        checked
                          ? 'bg-indigo-50/25 dark:bg-indigo-950/15'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleSuggestion(item.clusterId)}
                          aria-label={`Toggle rename for ${item.currentTitle}`}
                          className="mt-0.5 text-indigo-600 dark:text-indigo-400 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                        >
                          {checked ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-xs font-medium truncate ${
                              checked
                                ? 'line-through text-zinc-500 dark:text-zinc-400'
                                : 'text-zinc-800 dark:text-zinc-200'
                            }`}
                          >
                            {item.currentTitle}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                              {item.timelineLabel}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{item.reason}</span>
                            {item.status === 'synced' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-600 dark:text-amber-400">
                                  Already synced
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 sm:w-[46%] shrink-0">
                        <ArrowRight className="hidden sm:block h-3.5 w-3.5 text-zinc-400 shrink-0" />
                        <input
                          type="text"
                          value={draft}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSuggestionDrafts((prev) => ({ ...prev, [item.clusterId]: val }));
                            if (!checked) {
                              setSelectedSuggestionIds((prev) => [...prev, item.clusterId]);
                            }
                          }}
                          aria-label={`Proposed title for ${item.currentTitle}`}
                          className="w-full rounded-lg border border-zinc-200/90 dark:border-white/[0.10] bg-white dark:bg-[#0A0C10] px-2.5 py-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 dark:border-white/[0.07] bg-zinc-50/80 dark:bg-[#0E1117] px-5 py-3">
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSuggestionIds(renameSession.suggestions.map((s) => s.clusterId))
                    }
                    className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Select all ({renameSession.suggestions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSuggestionIds([])}
                    className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRenameSession(null);
                      setSelectedSuggestionIds([]);
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    disabled={selectedSuggestionIds.length === 0 || busyId === 'rename-batch'}
                    onClick={() => void handleApplySuggestions()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 tabular-nums"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {busyId === 'rename-batch'
                      ? 'Applying...'
                      : `Apply to ${selectedSuggestionIds.length} ${
                          selectedSuggestionIds.length === 1 ? 'Album' : 'Albums'
                        }`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sticky Merge Selection Bar */}
      {selectedIds.length > 0 && (
        <div className="sticky top-3 z-20 rounded-xl border border-indigo-300/90 dark:border-indigo-500/40 bg-white/95 dark:bg-[#111521]/95 backdrop-blur-md shadow-sm px-5 py-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-zinc-900 dark:text-zinc-100">
              <span className="font-semibold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                {selectedIds.length}
              </span>{' '}
              {selectedIds.length === 1
                ? 'album selected — select at least one more to merge'
                : `albums selected · ${selectedUniquePhotoCount.toLocaleString()} unique photos`}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length >= 2 && (
                <>
                  <input
                    type="text"
                    value={mergeTitle}
                    onChange={(e) => setMergeTitle(e.target.value)}
                    placeholder={suggestedMergeTitle || 'Merged album title (optional)'}
                    className="w-64 rounded-lg border border-zinc-200 dark:border-white/[0.12] bg-white dark:bg-[#0A0C10] px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={busyId === 'merge'}
                    onClick={handleMergeSubmit}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors tabular-nums"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    {busyId === 'merge' ? 'Merging...' : `Merge ${selectedIds.length} Albums`}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedIds([]);
                  setMergeTitle('');
                  setKeepOriginalsOnMerge(false);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] whitespace-nowrap shrink-0 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {selectedIds.length >= 2 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 dark:border-white/[0.06] pt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={keepOriginalsOnMerge}
                  onChange={(e) => setKeepOriginalsOnMerge(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Keep original color-tone chapters as separate albums</span>
              </label>
              <span>
                Combines only selected albums &amp; recomputes CIELAB palette. Unselected color albums stay untouched.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Proposed Album Cards Grid */}
      {filteredClusters.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#171B24] text-zinc-500 dark:text-zinc-400">
            <FolderKanban className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {clusters.length === 0
              ? 'No album proposals yet'
              : 'No album proposals match this filter'}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {clusters.length === 0
              ? 'Connect your Immich server or drop local photos in Library & Ingest, then run a scan to generate event and CIELAB color-tone albums.'
              : 'Try clearing the search input, switching filter tabs, or lowering the minimum photo threshold in Pipeline Lab.'}
          </p>
          {clusters.length === 0 && onOpenLibrary && (
            <button
              type="button"
              onClick={onOpenLibrary}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
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
                className={`group flex flex-col rounded-xl border bg-white dark:bg-[#11141B] overflow-hidden transition-colors duration-150 ${
                  isSelected
                    ? 'border-indigo-500 ring-1 ring-indigo-500/35'
                    : 'border-zinc-200/90 dark:border-white/[0.08] hover:border-zinc-300 dark:hover:border-white/[0.15]'
                }`}
              >
                {/* 4-Photo Thumbnail Mosaic Strip */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setInspectClusterId(cluster.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setInspectClusterId(cluster.id);
                    }
                  }}
                  aria-label={`Inspect photos in ${cluster.title}`}
                  className="relative grid grid-cols-4 gap-0.5 bg-zinc-100 dark:bg-[#0D1017] h-44 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  {previewAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="relative h-full w-full overflow-hidden bg-zinc-200 dark:bg-[#171B24]"
                    >
                      <ThumbnailImage
                        src={asset.thumbnailUrl}
                        alt={asset.fileName}
                        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                      />
                    </div>
                  ))}
                  {previewAssets.length < 4 &&
                    Array.from({ length: 4 - previewAssets.length }).map((_, i) => (
                      <div
                        key={`empty-${i}`}
                        className="h-full w-full bg-zinc-100 dark:bg-[#141821]"
                      />
                    ))}

                  {/* Measured dark scrim at top-left for selection checkbox */}
                  <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(cluster.id);
                    }}
                    aria-label={`Select ${cluster.title} for merge`}
                    className="absolute left-3 top-3 inline-flex items-center justify-center rounded-md bg-black/30 p-1 text-white/95 hover:bg-black/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-indigo-300" />
                    ) : (
                      <Square className="h-4 w-4 text-white/85" />
                    )}
                    <span className="sr-only">Select</span>
                  </button>

                  {/* Bottom scrim with photo count & LAB mean */}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 py-2.5 text-[11px] font-mono tabular-nums text-white/95">
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

                  {/* Quiet 1-line kicker metadata */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
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
                          className="flex-1 rounded-lg border border-indigo-500 bg-white dark:bg-[#0A0C10] px-2.5 py-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                        <button
                          type="button"
                          onClick={() => handleCommitRename(cluster.id)}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 whitespace-nowrap shrink-0"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                          aria-label="Cancel rename"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
                          {cluster.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleStartRename(cluster)}
                          title="Rename album"
                          aria-label={`Rename ${cluster.title}`}
                          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.07] dark:hover:text-zinc-200 transition-colors shrink-0"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Location, Date Range, People, EMD Metadata */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{cluster.locationLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {formatDateSpan(cluster.startDate, cluster.endDate)}
                    </span>
                    {cluster.signalBreakdown && cluster.signalBreakdown.namedPeople.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-zinc-600 dark:text-zinc-300">
                          with {cluster.signalBreakdown.namedPeople.slice(0, 3).join(', ')}
                          {cluster.signalBreakdown.namedPeople.length > 3
                            ? ` +${cluster.signalBreakdown.namedPeople.length - 3}`
                            : ''}
                        </span>
                      </>
                    )}
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
                  <div className="mt-auto pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 dark:border-white/[0.06] pt-3.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSelect(cluster.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                              : 'border-zinc-200 dark:border-white/[0.10] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/[0.05]'
                          }`}
                        >
                          <GitMerge className="h-3.5 w-3.5" />
                          {isSelected ? 'Selected' : 'Merge'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setInspectClusterId(cluster.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.05] transition-colors whitespace-nowrap shrink-0"
                        >
                          <Scissors className="h-3.5 w-3.5" />
                          Inspect &amp; Split
                        </button>

                        {cluster.status === 'discarded' ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onStatusChange(cluster.id, 'pending')}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onStatusChange(cluster.id, 'discarded')}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors whitespace-nowrap shrink-0"
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
                            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-500/35 bg-indigo-50/70 dark:bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/70 transition-colors whitespace-nowrap shrink-0"
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
                                ? 'bg-zinc-100 dark:bg-white/[0.06] text-zinc-500 dark:text-zinc-400 cursor-default'
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
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Inspect & Manual Split Modal Drawer */}
      {inspectedCluster && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]"
          onClick={() => setInspectClusterId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={inspectedCluster.title}
            className="animate-drawer-in flex h-full w-full max-w-2xl flex-col bg-white dark:bg-[#0D1017] border-l border-zinc-200 dark:border-white/[0.08] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 dark:border-white/[0.08] px-6 py-4">
              <div className="min-w-0">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {clusterTypeLabel(inspectedCluster.clusterType)} · {inspectedCluster.moodLabel} ·{' '}
                  <span className="font-mono">{inspectedCluster.clusterHash}</span>
                </p>
                <h2 className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {inspectedCluster.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectClusterId(null)}
                aria-label="Close inspector"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-zinc-200 dark:border-white/[0.08] px-6 py-4 bg-zinc-50/80 dark:bg-[#11141B] space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Cluster 5-color CIELAB palette</span>
                  <span className="font-mono tabular-nums">
                    {inspectedCluster.assetIds.length} frames
                  </span>
                </div>
                <PaletteBar
                  swatches={inspectedCluster.palette}
                  heightClass="h-4"
                  interactive={false}
                  showLegend
                />
              </div>

              {inspectedCluster.signalBreakdown && (
                <div className="pt-2.5 border-t border-zinc-200/70 dark:border-white/[0.06] text-[11px] text-zinc-500 dark:text-zinc-400 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                        Active signals:{' '}
                      </strong>
                      {[
                        inspectedCluster.signalBreakdown.gps && 'GPS',
                        inspectedCluster.signalBreakdown.immichMl && 'Immich ML',
                        inspectedCluster.signalBreakdown.chroma && 'CIELAB Chroma',
                        inspectedCluster.signalBreakdown.faces && 'Faces',
                        inspectedCluster.signalBreakdown.exif && 'EXIF',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {inspectedCluster.signalBreakdown.favoriteCount > 0 && (
                      <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                        {inspectedCluster.signalBreakdown.favoriteCount} favorites
                      </span>
                    )}
                  </div>
                  {inspectedCluster.signalBreakdown.topTags.length > 0 && (
                    <div>
                      <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                        Immich ML concepts:{' '}
                      </strong>
                      {inspectedCluster.signalBreakdown.topTags.join(', ')}
                    </div>
                  )}
                  {inspectedCluster.signalBreakdown.namedPeople.length > 0 && (
                    <div>
                      <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                        Recognized people:{' '}
                      </strong>
                      {inspectedCluster.signalBreakdown.namedPeople.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                Frames ordered chronologically. Click{' '}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Split here</strong>{' '}
                between any two photos to divide this cluster into two separate Immich albums.
              </p>

              <div className="space-y-1.5">
                {(inspectedCluster.assets || []).map((asset, idx) => (
                  <div key={asset.id}>
                    {idx > 0 && (
                      <div className="my-2 flex items-center gap-3">
                        <div className="h-px flex-1 bg-zinc-200/80 dark:bg-white/[0.07]" />
                        <button
                          type="button"
                          disabled={busyId === inspectedCluster.id}
                          onClick={async () => {
                            await onSplit(inspectedCluster.id, idx);
                            setInspectClusterId(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300 transition-colors whitespace-nowrap"
                        >
                          <Scissors className="h-3 w-3" />
                          Split here ({idx} / {(inspectedCluster.assets || []).length - idx})
                        </button>
                        <div className="h-px flex-1 bg-zinc-200/80 dark:bg-white/[0.07]" />
                      </div>
                    )}

                    <div className="flex items-center gap-3.5 rounded-lg border border-zinc-200/80 dark:border-white/[0.07] bg-white dark:bg-[#11141B] p-2.5">
                      <div className="h-14 w-20 overflow-hidden rounded-md bg-zinc-100 dark:bg-[#171B24] shrink-0">
                        <ThumbnailImage src={asset.thumbnailUrl} alt={asset.fileName} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {asset.fileName}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                            {new Date(asset.localDateTime).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'UTC',
                            })}{' '}
                            UTC
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
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
                              <span className="truncate">
                                {asset.smartTags.slice(0, 3).join(', ')}
                              </span>
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
