import { CheckCircle2, CornerDownRight, History, Layers, UploadCloud } from 'lucide-react';
import { useMemo } from 'react';
import type { ClusterRecord, ImmichStatus, SyncHistoryRecord } from '../shared/types.ts';
import { PaletteBar } from './PaletteBar.tsx';

interface SyncLedgerViewProps {
  clusters: ClusterRecord[];
  syncHistory: SyncHistoryRecord[];
  immichStatus: ImmichStatus;
  busyAction: string | null;
  onSyncCluster: (id: string) => Promise<void>;
}

export function SyncLedgerView({
  clusters,
  syncHistory,
  immichStatus,
  busyAction,
  onSyncCluster,
}: SyncLedgerViewProps) {
  const alphabeticalFlatList = useMemo(() => {
    return clusters
      .filter((c) => c.status !== 'discarded')
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [clusters]);

  return (
    <div className="space-y-6">
      {/* Flat-Album Hierarchy Preview */}
      <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200/80 dark:border-white/[0.07] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Immich Flat-Album Hierarchy Preview
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Alphabetical sort order inside Immich using Structured Prefix Naming &amp; zero-duplication multi-album assignment.
              </p>
            </div>
          </div>

          <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {alphabeticalFlatList.length} active
          </span>
        </div>

        {alphabeticalFlatList.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#171B24] text-zinc-500 dark:text-zinc-400">
              <Layers className="h-4 w-4" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No proposed albums yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Connect your Immich server in Library &amp; Ingest and run a scan to populate the flat-album hierarchy preview.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {alphabeticalFlatList.map((cluster) => {
              const isSubChapter = cluster.clusterType === 'chapter';
              const delta =
                cluster.immichAlbumId !== null
                  ? Math.max(0, cluster.assetIds.length - cluster.syncedAssetCount)
                  : 0;

              return (
                <div
                  key={cluster.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 hover:bg-zinc-50/70 dark:hover:bg-white/[0.025] transition-colors"
                >
                  <div className={`min-w-0 flex-1 ${isSubChapter ? 'pl-5' : ''}`}>
                    <div className="flex items-center gap-2">
                      {isSubChapter && (
                        <CornerDownRight className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {cluster.title}
                      </span>
                    </div>
                    <div
                      className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400 ${
                        isSubChapter ? 'pl-5' : ''
                      }`}
                    >
                      <span>{isSubChapter ? 'Sub-Album (Overlapping)' : 'Master Event Album'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{cluster.assetIds.length} assets</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">hash:{cluster.clusterHash.slice(0, 10)}</span>
                      {cluster.immichAlbumId && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-emerald-700 dark:text-emerald-400">
                            {cluster.immichAlbumId}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="hidden sm:block w-24">
                      <PaletteBar swatches={cluster.palette} heightClass="h-2.5" interactive={false} />
                    </div>

                    {delta > 0 ? (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => onSyncCluster(cluster.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                        Append +{delta} via PUT
                      </button>
                    ) : cluster.status === 'synced' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Up to date
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => onSyncCluster(cluster.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.05] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                      >
                        Create via POST
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Idempotent Sync Ledger Table */}
      <section className="rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-white/[0.07] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <History className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                SQLite Idempotent Sync Ledger
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Target mode:{' '}
                {immichStatus.configured && immichStatus.reachable
                  ? `Live Immich (${immichStatus.hostLabel})`
                  : 'Local SQLite Ledger (connect Immich in Library & Ingest for live writes)'}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {syncHistory.length} operations recorded
          </span>
        </div>

        {syncHistory.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#171B24] text-zinc-500 dark:text-zinc-400">
              <History className="h-4 w-4" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No albums synced yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Approve and sync clusters from the Review Queue or click Create via POST above to write albums idempotently.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200/80 dark:border-white/[0.07] bg-zinc-50/80 dark:bg-[#0D1017] text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 pl-6 pr-3 font-medium">Timestamp</th>
                  <th className="py-2.5 px-3 font-medium">Album Title</th>
                  <th className="py-2.5 px-3 font-medium">Method</th>
                  <th className="py-2.5 px-3 font-medium">Immich Album ID</th>
                  <th className="py-2.5 px-3 font-medium text-right">Added</th>
                  <th className="py-2.5 pl-3 pr-6 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                {syncHistory.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-zinc-50/70 dark:hover:bg-white/[0.025] transition-colors"
                  >
                    <td className="py-3 pl-6 pr-3 font-mono tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {new Date(row.syncedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {row.albumTitle}
                    </td>
                    <td className="py-3 px-3 font-mono whitespace-nowrap">
                      <span
                        className={
                          row.action === 'appended'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {row.action === 'appended' ? 'PUT /albums/{id}/assets' : 'POST /albums'}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {row.immichAlbumId}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      +{row.addedCount}
                    </td>
                    <td className="py-3 pl-3 pr-6 font-mono tabular-nums text-right text-zinc-600 dark:text-zinc-400">
                      {row.totalInAlbum}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
