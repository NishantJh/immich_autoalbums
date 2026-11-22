import { Layers, PlusCircle, UploadCloud } from 'lucide-react';
import { useMemo } from 'react';
import type { ClusterRecord, ImmichStatus, SyncHistoryRecord } from '../shared/types.ts';
import { PaletteBar } from './PaletteBar.tsx';

interface SyncLedgerViewProps {
  clusters: ClusterRecord[];
  syncHistory: SyncHistoryRecord[];
  immichStatus: ImmichStatus;
  busyAction: string | null;
  onSimulateNewPhotos: () => Promise<void>;
  onSyncCluster: (id: string) => Promise<void>;
}

export function SyncLedgerView({
  clusters,
  syncHistory,
  immichStatus,
  busyAction,
  onSimulateNewPhotos,
  onSyncCluster,
}: SyncLedgerViewProps) {
  // Alphabetically sorted active albums demonstrating Immich's flat-album list hierarchy
  const alphabeticalFlatList = useMemo(() => {
    return clusters
      .filter((c) => c.status !== 'discarded')
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [clusters]);

  return (
    <div className="space-y-6">
      {/* Flat-Album Strategy & Incremental Append Simulator */}
      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Immich Flat-Album Hierarchy Preview
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Alphabetical sort order inside Immich using Structured Prefix Naming &amp; zero-duplication multi-album assignment.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={onSimulateNewPhotos}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 px-3.5 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/70 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            {busyAction === 'simulate'
              ? 'Adding 3 Goa photos...'
              : 'Simulate +3 New Goa Photos'}
          </button>
        </div>

        <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
          {alphabeticalFlatList.map((cluster) => {
            const isSubChapter = cluster.clusterType === 'chapter';
            const delta =
              cluster.immichAlbumId !== null
                ? Math.max(0, cluster.assetIds.length - cluster.syncedAssetCount)
                : 0;

            return (
              <div
                key={cluster.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 hover:bg-neutral-50/70 dark:hover:bg-neutral-900/40 transition-colors"
              >
                <div className={`min-w-0 flex-1 ${isSubChapter ? 'pl-6' : ''}`}>
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                      {cluster.title}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500 dark:text-neutral-400">
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 whitespace-nowrap shrink-0"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      Append +{delta} via PUT
                    </button>
                  ) : cluster.status === 'synced' ? (
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      Up to date
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => onSyncCluster(cluster.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
                    >
                      Create via POST
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Idempotent Sync Ledger Table */}
      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              SQLite Idempotent Sync Ledger
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Target mode:{' '}
              {immichStatus.configured && immichStatus.reachable
                ? `Live Immich (${immichStatus.hostLabel})`
                : 'Local SQLite Ledger (configure IMMICH_URL & IMMICH_API_KEY for live writes)'}
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
            {syncHistory.length} operations recorded
          </span>
        </div>

        {syncHistory.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              No albums synced yet
            </p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Click Create via POST above or Sync to Immich in the Review Queue. Then click Simulate +3 New Goa Photos to test idempotent PUT appending.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400">
                  <th className="py-2.5 pl-6 pr-3 font-medium">Timestamp</th>
                  <th className="py-2.5 px-3 font-medium">Album Title</th>
                  <th className="py-2.5 px-3 font-medium">Method</th>
                  <th className="py-2.5 px-3 font-medium">Immich Album ID</th>
                  <th className="py-2.5 px-3 font-medium text-right">Added</th>
                  <th className="py-2.5 pl-3 pr-6 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {syncHistory.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-neutral-50/70 dark:hover:bg-neutral-900/40 transition-colors"
                  >
                    <td className="py-3 pl-6 pr-3 font-mono tabular-nums text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      {new Date(row.syncedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-3 font-medium text-neutral-900 dark:text-neutral-100">
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
                    <td className="py-3 px-3 font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                      {row.immichAlbumId}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right text-neutral-900 dark:text-neutral-100">
                      +{row.addedCount}
                    </td>
                    <td className="py-3 pl-3 pr-6 font-mono tabular-nums text-right text-neutral-600 dark:text-neutral-400">
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
