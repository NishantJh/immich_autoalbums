import {
  AlertCircle,
  CheckCircle2,
  Database,
  FolderKanban,
  GitBranch,
  History,
  Loader2,
  Menu,
  Moon,
  Play,
  Sliders,
  Sun,
  UploadCloud,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LibraryIngestView } from './components/LibraryIngestView.tsx';
import { PipelineLabView } from './components/PipelineLabView.tsx';
import { PullProgressBanner } from './components/PullProgressBanner.tsx';
import { ReviewQueueView } from './components/ReviewQueueView.tsx';
import { RulesDeployView } from './components/RulesDeployView.tsx';
import { SyncLedgerView } from './components/SyncLedgerView.tsx';
import type {
  AssetRecord,
  ClusterRecord,
  DashboardBootstrap,
  ImmichStatus,
  OrganizerSettings,
  PipelineRunSummary,
  PullProgressState,
  RenameSuggestion,
  SyncHistoryRecord,
} from './shared/types.ts';

type WorkspaceSection = 'review' | 'pipeline' | 'sync' | 'library' | 'rules';

const SECTION_META: Record<
  WorkspaceSection,
  { label: string; title: string; subtitle: string }
> = {
  review: {
    label: 'Review Queue',
    title: 'Proposed Event & Color-Tone Albums',
    subtitle:
      'Inspect extracted 5-color CIELAB palettes, rename titles inline, merge or split boundaries, and approve safe syncs to Immich.',
  },
  pipeline: {
    label: 'Pipeline Lab',
    title: 'Four-Stage Clustering & CIELAB Scene Split',
    subtitle:
      'Calibrate home-base inference, spatiotemporal gaps, and sliding-window Earth Mover’s Distance thresholds.',
  },
  sync: {
    label: 'Sync Ledger',
    title: 'Flat-Album Hierarchy & Idempotent Sync Map',
    subtitle:
      'Preview alphabetical prefix grouping in Immich and verify incremental PUT appends without duplicate album creation.',
  },
  library: {
    label: 'Library & Ingest',
    title: 'Photo Sources & SQLite Feature Cache',
    subtitle:
      'Connect your self-hosted Immich server or drop local photos for real EXIF and CIELAB palette extraction.',
  },
  rules: {
    label: 'Rules & Config',
    title: 'Exclusion Rules & Album Configuration',
    subtitle:
      'Configure ignored folders, Immich flat-album naming prefixes, and scheduled scan cadence.',
  },
};

export default function App() {
  const [section, setSection] = useState<WorkspaceSection>('review');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('chromacluster_theme') === 'dark';
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [pullProgress, setPullProgress] = useState<PullProgressState | null>(null);
  const wasPullActiveRef = useRef(false);

  const [immichStatus, setImmichStatus] = useState<ImmichStatus>({
    configured: false,
    reachable: false,
    source: null,
    baseUrl: null,
    hostLabel: null,
    maskedApiKey: null,
    serverVersion: null,
    lastError: null,
  });
  const [settings, setSettings] = useState<OrganizerSettings | null>(null);
  const [clusters, setClusters] = useState<ClusterRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineRunSummary | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryRecord[]>([]);

  const notify = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('chromacluster_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('chromacluster_theme', 'light');
    }
  }, [darkMode]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bootstrap');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DashboardBootstrap;
      setImmichStatus(data.immichStatus);
      setSettings(data.settings);
      setClusters(data.clusters);
      setAssets(data.assets);
      setPipelineSummary(data.pipelineSummary);
      setSyncHistory(data.syncHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach local organizer backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBootstrapSilent = useCallback(async () => {
    try {
      const res = await fetch('/api/bootstrap');
      if (!res.ok) return;
      const data = (await res.json()) as DashboardBootstrap;
      setImmichStatus(data.immichStatus);
      setSettings(data.settings);
      setClusters(data.clusters);
      setAssets(data.assets);
      setPipelineSummary(data.pipelineSummary);
      setSyncHistory(data.syncHistory);
    } catch {
      // Non-fatal silent refresh
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
    // Reconnect to any in-progress server pull if user refreshed mid-pull
    void (async () => {
      try {
        const res = await fetch('/api/pipeline/progress');
        if (!res.ok) return;
        const data = (await res.json()) as { progress: PullProgressState };
        if (data.progress?.active) {
          wasPullActiveRef.current = true;
          setPullProgress(data.progress);
          setIsScanning(true);
        }
      } catch {
        // Ignore initial probe error
      }
    })();
  }, [loadBootstrap]);

  // Poll live pull progress every 400ms while a pull job is running
  useEffect(() => {
    if (!pullProgress?.active) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/pipeline/progress');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { progress: PullProgressState };
        const next = data.progress;
        setPullProgress(next);

        if (!next.active && wasPullActiveRef.current) {
          wasPullActiveRef.current = false;
          setIsScanning(false);
          setBusyId((curr) => (curr === 'immich-ingest' ? null : curr));
          await refreshBootstrapSilent();
          if (next.phase === 'error') {
            notify(next.error || 'Immich pull failed', 'err');
          } else if (next.phase === 'done') {
            notify(next.detail || 'Pull & scan complete.');
          }
        }
      } catch {
        // Retry next interval
      }
    };

    const timer = setInterval(() => void poll(), 400);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pullProgress?.active, refreshBootstrapSilent, notify]);

  const handleCancelPull = async () => {
    try {
      const res = await fetch('/api/pipeline/cancel', { method: 'POST' });
      if (!res.ok) return;
      const data = (await res.json()) as { progress: PullProgressState };
      setPullProgress(data.progress);
    } catch {
      // Non-fatal
    }
  };

  const handleRunPipeline = async () => {
    setIsScanning(true);
    const started = Date.now();
    try {
      const res = await fetch('/api/pipeline/run', { method: 'POST' });
      const data = (await res.json()) as {
        error?: string;
        started?: boolean;
        progress?: PullProgressState;
        mode?: 'live_immich' | 'local_fallback' | 'local_cache';
        ingested?: number;
        immichWarning?: string;
        immichStatus?: ImmichStatus;
        summary?: PipelineRunSummary;
        clusters?: ClusterRecord[];
        assets?: AssetRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Pipeline run failed');

      if (data.immichStatus) setImmichStatus(data.immichStatus);

      // Async live Immich pull started — progress banner & polling take over
      if (data.started && data.progress) {
        wasPullActiveRef.current = true;
        setPullProgress(data.progress);
        return;
      }

      const elapsed = Date.now() - started;
      if (elapsed < 300) {
        await new Promise((r) => setTimeout(r, 300 - elapsed));
      }

      if (data.summary) setPipelineSummary(data.summary);
      if (data.clusters) setClusters(data.clusters);
      if (data.assets) setAssets(data.assets);

      if (data.mode === 'local_fallback') {
        notify(
          `Immich unreachable (${data.immichWarning || 'check URL/key'}). Scanned ${data.summary?.stage1.eligibleAssets ?? 0} local cached assets.`,
          'err'
        );
      } else {
        notify(
          `Scan complete in ${data.summary?.durationMs ?? 0} ms — evaluated ${data.summary?.stage1.eligibleAssets ?? 0} eligible assets into ${data.clusters?.length ?? 0} album proposals.`
        );
      }
      setIsScanning(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Scan failed', 'err');
      setIsScanning(false);
    }
  };

  const handleClearCacheAndRun = async () => {
    setIsScanning(true);
    try {
      const clearRes = await fetch('/api/pipeline/clear-cache', { method: 'POST' });
      if (!clearRes.ok) throw new Error('Failed to clear SQLite LAB cache');
      const res = await fetch('/api/pipeline/run', { method: 'POST' });
      const data = (await res.json()) as {
        error?: string;
        immichStatus?: ImmichStatus;
        summary: PipelineRunSummary;
        clusters: ClusterRecord[];
        assets: AssetRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Pipeline re-extraction failed');
      if (data.immichStatus) setImmichStatus(data.immichStatus);
      setPipelineSummary(data.summary);
      setClusters(data.clusters);
      setAssets(data.assets);
      notify(
        `Re-extracted CIELAB features for ${data.summary.stage1.newlyExtracted} thumbnails in ${data.summary.durationMs} ms.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cache reset failed', 'err');
    } finally {
      setIsScanning(false);
    }
  };

  const handleRename = async (
    id: string,
    title: string,
    timelineWindowDays = 14
  ): Promise<{
    renameSuggestions: RenameSuggestion[];
    renamedCluster?: { id: string; oldTitle: string; newTitle: string };
  }> => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/clusters/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, timelineWindowDays }),
      });
      if (!res.ok) throw new Error('Rename failed');
      const data = (await res.json()) as {
        clusters: ClusterRecord[];
        renameSuggestions?: RenameSuggestion[];
        renamedCluster?: { id: string; oldTitle: string; newTitle: string };
      };
      setClusters(data.clusters);
      const count = data.renameSuggestions?.length || 0;
      notify(
        count > 0
          ? `Album title updated — ${count} nearby ${count === 1 ? 'album' : 'albums'} can adopt this change.`
          : 'Album title updated.'
      );
      return {
        renameSuggestions: data.renameSuggestions || [],
        renamedCluster: data.renamedCluster,
      };
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rename failed', 'err');
      return { renameSuggestions: [] };
    } finally {
      setBusyId(null);
    }
  };

  const handleFetchRenameSuggestions = async (
    id: string,
    oldTitle: string,
    newTitle: string,
    timelineWindowDays: number
  ): Promise<RenameSuggestion[]> => {
    try {
      const res = await fetch(`/api/clusters/${encodeURIComponent(id)}/rename-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldTitle, newTitle, timelineWindowDays }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { renameSuggestions?: RenameSuggestion[] };
      return data.renameSuggestions || [];
    } catch {
      return [];
    }
  };

  const handleBatchRename = async (
    updates: Array<{ id: string; title: string }>
  ): Promise<boolean> => {
    if (updates.length === 0) return false;
    setBusyId('rename-batch');
    try {
      const res = await fetch('/api/clusters/rename-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = (await res.json()) as {
        error?: string;
        updatedCount?: number;
        clusters?: ClusterRecord[];
      };
      if (!res.ok || !data.clusters) throw new Error(data.error || 'Batch rename failed');
      setClusters(data.clusters);
      const n = data.updatedCount ?? updates.length;
      notify(`Updated ${n} nearby album ${n === 1 ? 'title' : 'titles'}.`);
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Batch rename failed', 'err');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (
    id: string,
    status: 'pending' | 'approved' | 'discarded'
  ) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/clusters/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Status update failed');
      const data = (await res.json()) as { clusters: ClusterRecord[] };
      setClusters(data.clusters);
      notify(
        status === 'approved'
          ? 'Marked approved for sync.'
          : status === 'discarded'
            ? 'Cluster moved to discarded.'
            : 'Cluster restored to review queue.'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncOne = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/clusters/${encodeURIComponent(id)}/sync`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        error?: string;
        history: SyncHistoryRecord;
        clusters: ClusterRecord[];
        syncHistory: SyncHistoryRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setClusters(data.clusters);
      setSyncHistory(data.syncHistory);
      notify(
        data.history.action === 'appended'
          ? `Appended +${data.history.addedCount} photos to ${data.history.immichAlbumId} via PUT.`
          : `Created album ${data.history.immichAlbumId} with ${data.history.addedCount} photos via POST.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Sync failed', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncApproved = async () => {
    setBusyId('sync-all');
    try {
      const res = await fetch('/api/clusters/sync-approved', { method: 'POST' });
      const data = (await res.json()) as {
        error?: string;
        syncedCount: number;
        clusters: ClusterRecord[];
        syncHistory: SyncHistoryRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Batch sync failed');
      setClusters(data.clusters);
      setSyncHistory(data.syncHistory);
      notify(`Synced ${data.syncedCount} approved albums idempotently.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Batch sync failed', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleMerge = async (clusterIds: string[], title?: string) => {
    setBusyId('merge');
    try {
      const res = await fetch('/api/clusters/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterIds, title }),
      });
      const data = (await res.json()) as { error?: string; clusters: ClusterRecord[] };
      if (!res.ok) throw new Error(data.error || 'Merge failed');
      setClusters(data.clusters);
      notify(`Merged ${clusterIds.length} clusters and recomputed CIELAB palette.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleSplit = async (id: string, splitIndex: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/clusters/${encodeURIComponent(id)}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splitIndex }),
      });
      const data = (await res.json()) as { error?: string; clusters: ClusterRecord[] };
      if (!res.ok) throw new Error(data.error || 'Split failed');
      setClusters(data.clusters);
      notify('Split cluster into two separate chapters.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Split failed', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveSettings = async (payload: {
    settings?: Partial<OrganizerSettings>;
    rerun: boolean;
  }) => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        settings: OrganizerSettings;
        summary?: PipelineRunSummary;
        clusters?: ClusterRecord[];
        assets?: AssetRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSettings(data.settings);
      if (data.summary) setPipelineSummary(data.summary);
      if (data.clusters) setClusters(data.clusters);
      if (data.assets) setAssets(data.assets);
      notify('Settings saved and pipeline refreshed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save settings';
      notify(msg, 'err');
      throw err;
    } finally {
      setIsScanning(false);
    }
  };

  const handleClearLocalCache = async () => {
    setBusyId('clear-cache');
    try {
      const res = await fetch('/api/library/clear', { method: 'POST' });
      const data = (await res.json()) as {
        error?: string;
        cleared: number;
        summary: PipelineRunSummary;
        clusters: ClusterRecord[];
        assets: AssetRecord[];
        syncHistory: SyncHistoryRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Failed to clear local cache');
      setPipelineSummary(data.summary);
      setClusters(data.clusters);
      setAssets(data.assets);
      setSyncHistory(data.syncHistory);
      notify(`Cleared ${data.cleared} cached assets and thumbnails from local storage.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to clear cache', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleUploadPhotos = async (
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
  ) => {
    setBusyId('upload');
    try {
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const data = (await res.json()) as {
        error?: string;
        inserted: number;
        summary: PipelineRunSummary;
        clusters: ClusterRecord[];
        assets: AssetRecord[];
      };
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setPipelineSummary(data.summary);
      setClusters(data.clusters);
      setAssets(data.assets);
      notify(`Ingested ${data.inserted} local photos and extracted real CIELAB palettes.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Upload failed', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleTestImmichConfig = async (url: string, apiKey: string) => {
    const res = await fetch('/api/immich/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, apiKey, testOnly: true }),
    });
    const data = (await res.json()) as {
      error?: string;
      probe?: {
        reachable: boolean;
        serverVersion: string | null;
        lastError: string | null;
      };
    };
    if (!res.ok || !data.probe) {
      throw new Error(data.error || 'Connection test failed');
    }
    return data.probe;
  };

  const handleSaveImmichConfig = async (url: string, apiKey: string) => {
    setBusyId('immich-save');
    try {
      const res = await fetch('/api/immich/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, apiKey }),
      });
      const data = (await res.json()) as { error?: string; status?: ImmichStatus };
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Failed to save Immich connection');
      }
      setImmichStatus(data.status);
      notify(
        data.status.reachable
          ? `Immich connection saved (${data.status.serverVersion || 'connected'}).`
          : 'Immich URL & API key saved on server (server currently unreachable).'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save Immich connection', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnectImmich = async () => {
    setBusyId('immich-disconnect');
    try {
      const res = await fetch('/api/immich/config', { method: 'DELETE' });
      const data = (await res.json()) as { status: ImmichStatus };
      setImmichStatus(data.status);
      notify('Saved Immich credentials cleared.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to clear credentials', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleIngestImmich = async (options?: {
    maxAssets?: number;
    takenAfter?: string;
    takenBefore?: string;
  }) => {
    setBusyId('immich-ingest');
    setIsScanning(true);
    try {
      const res = await fetch('/api/immich/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      const data = (await res.json()) as {
        error?: string;
        started?: boolean;
        progress?: PullProgressState;
      };
      if (!res.ok) throw new Error(data.error || 'Immich ingest failed');

      if (data.started && data.progress) {
        wasPullActiveRef.current = true;
        setPullProgress(data.progress);
        return;
      }
      await refreshBootstrapSilent();
      setBusyId(null);
      setIsScanning(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Immich ingest failed', 'err');
      setBusyId(null);
      setIsScanning(false);
    }
  };

  const approvedCount = useMemo(
    () => clusters.filter((c) => c.status === 'approved').length,
    [clusters]
  );

  const syncedCount = useMemo(
    () => clusters.filter((c) => c.status === 'synced').length,
    [clusters]
  );

  const activeClusterCount = useMemo(
    () => clusters.filter((c) => c.status !== 'discarded').length,
    [clusters]
  );

  const navItems: Array<{
    id: WorkspaceSection;
    label: string;
    icon: typeof FolderKanban;
    metric?: number;
  }> = [
    { id: 'review', label: 'Review Queue', icon: FolderKanban, metric: activeClusterCount },
    {
      id: 'pipeline',
      label: 'Pipeline Lab',
      icon: GitBranch,
      metric: pipelineSummary?.stage3.sceneSplitsDetected,
    },
    { id: 'sync', label: 'Sync Ledger', icon: History, metric: syncedCount },
    { id: 'library', label: 'Library & Ingest', icon: Database, metric: assets.length },
    { id: 'rules', label: 'Rules & Config', icon: Sliders },
  ];

  const meta = SECTION_META[section];
  const hasHomeBase =
    pipelineSummary &&
    pipelineSummary.stage2.homeBaseCity &&
    pipelineSummary.stage2.homeBaseCity !== '—';

  return (
    <div className="min-h-screen flex bg-[#F7F8FA] text-[#111318] dark:bg-[#0A0C10] dark:text-[#F1F3F7]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-zinc-200/90 dark:border-white/[0.07] bg-white dark:bg-[#0E1117]">
        <div className="flex h-16 items-center gap-2.5 px-5 border-b border-zinc-200/80 dark:border-white/[0.07]">
          <img
            src="/icon.png"
            alt=""
            className="h-6 w-6 rounded-md shrink-0 ring-1 ring-black/10 dark:ring-white/15"
          />
          <span className="font-display text-[15px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            ChromaCluster
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? 'bg-indigo-50/90 text-indigo-700 dark:bg-indigo-500/[0.14] dark:text-indigo-300'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/80 dark:hover:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-indigo-600 dark:text-indigo-400' : 'opacity-75'
                    }`}
                  />
                  <span>{item.label}</span>
                </span>
                {typeof item.metric === 'number' && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? 'text-indigo-700 dark:text-indigo-300' : 'text-zinc-400 dark:text-zinc-500'
                    }`}
                  >
                    {item.metric}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-zinc-200/80 dark:border-white/[0.07] px-5 py-4 text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
          <button
            type="button"
            onClick={() => setSection('library')}
            className="block w-full text-left group"
          >
            <div className="flex items-center justify-between gap-2 font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              <span className="truncate">
                {immichStatus.reachable
                  ? 'Live Immich Sidecar'
                  : immichStatus.configured
                    ? 'Immich Unreachable'
                    : 'Immich Not Connected'}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {immichStatus.hostLabel || 'Configure in Library & Ingest'}
            </div>
          </button>
          <a
            href="https://github.com/NishantJh/immich_autoalbums"
            target="_blank"
            rel="noreferrer"
            className="inline-block pt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            NishantJh/immich_autoalbums
          </a>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden bg-black/50 backdrop-blur-[2px]"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="flex w-64 flex-col bg-white dark:bg-[#0E1117] border-r border-zinc-200 dark:border-white/[0.08]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between px-4 border-b border-zinc-200 dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <img
                  src="/icon.png"
                  alt=""
                  className="h-6 w-6 rounded-md shrink-0 ring-1 ring-black/10 dark:ring-white/15"
                />
                <span className="font-display text-[15px] font-bold tracking-tight">
                  ChromaCluster
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/[0.14] dark:text-indigo-300'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {typeof item.metric === 'number' && (
                      <span className="font-mono text-xs tabular-nums opacity-70">
                        {item.metric}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Workspace Column */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        {/* Top Workspace Header */}
        <header className="sticky top-0 z-30 flex h-14 sm:h-16 items-center justify-between gap-4 border-b border-zinc-200/90 dark:border-white/[0.07] bg-white/92 dark:bg-[#0E1117]/92 backdrop-blur-sm px-4 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg p-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-zinc-400 dark:text-zinc-500 hidden sm:inline">Workspace</span>
              <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline">/</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {meta.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to darkroom mode'}
              title={darkMode ? 'Switch to light mode' : 'Switch to darkroom mode'}
              className="rounded-lg border border-zinc-200/90 dark:border-white/[0.10] p-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {approvedCount > 0 && (
              <button
                type="button"
                disabled={busyId === 'sync-all'}
                onClick={handleSyncApproved}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 tabular-nums"
              >
                {busyId === 'sync-all' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UploadCloud className="h-3.5 w-3.5" />
                )}
                {busyId === 'sync-all' ? 'Syncing...' : `Sync Approved (${approvedCount})`}
              </button>
            )}

            <button
              type="button"
              disabled={isScanning || Boolean(pullProgress?.active)}
              aria-busy={isScanning || Boolean(pullProgress?.active)}
              onClick={handleRunPipeline}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0E1117]"
            >
              {isScanning || pullProgress?.active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {pullProgress?.active
                ? `Scanning ${pullProgress.percent}%...`
                : isScanning
                  ? 'Scanning...'
                  : 'Run Scan'}
            </button>
          </div>
        </header>

        {/* Main Viewport Content */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8 space-y-6">
          {/* Page Header */}
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-[-0.02em] text-zinc-900 dark:text-zinc-100">
              {meta.title}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-3xl leading-relaxed">
              {meta.subtitle}
            </p>
          </div>

          {/* Live Immich Pull & Scan Progress Banner */}
          {pullProgress?.active && (
            <PullProgressBanner progress={pullProgress} onCancel={handleCancelPull} />
          )}

          {/* 4-Column Single-Elevation Summary Strip */}
          {pipelineSummary && (
            <div className="grid grid-cols-2 divide-y divide-zinc-200/80 dark:divide-white/[0.07] rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#11141B] sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
              <div className="px-5 py-4">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Eligible Assets</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                    {pipelineSummary.stage1.eligibleAssets}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                    of {pipelineSummary.stage1.totalAssets}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSection('rules')}
                className="group px-5 py-4 text-left hover:bg-zinc-50/80 dark:hover:bg-white/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    {pipelineSummary.stage2.homeBaseSource === 'manual'
                      ? 'Manual Home Base'
                      : pipelineSummary.stage2.homeBaseSource === 'disabled'
                        ? 'Home Base'
                        : 'Inferred Home Base'}
                  </span>
                  <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 opacity-80 group-hover:opacity-100">
                    Change
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2 min-w-0">
                  <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
                    {hasHomeBase ? pipelineSummary.stage2.homeBaseCity : '—'}
                  </span>
                  {hasHomeBase &&
                    pipelineSummary.stage2.homeBaseSource !== 'disabled' &&
                    pipelineSummary.stage2.homeBaseCountry &&
                    pipelineSummary.stage2.homeBaseCountry !==
                      pipelineSummary.stage2.homeBaseCity && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate shrink-0">
                        {pipelineSummary.stage2.homeBaseCountry}
                      </span>
                    )}
                </div>
              </button>

              <div className="px-5 py-4">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">CIELAB Scene Splits</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                    {pipelineSummary.stage3.sceneSplitsDetected}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    {pipelineSummary.stage3.totalChaptersCreated} chapters
                  </span>
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Albums Synced</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                    {syncedCount}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                    / {activeClusterCount} active
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error / Loading / Active View */}
          {error ? (
            <div className="rounded-xl border border-rose-200 dark:border-rose-500/25 bg-rose-50/70 dark:bg-rose-950/30 p-6 text-sm text-rose-800 dark:text-rose-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Unable to load organizer state
              </div>
              <p className="mt-1 text-xs opacity-85">{error}</p>
              <button
                type="button"
                onClick={loadBootstrap}
                className="mt-4 rounded-lg bg-rose-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-800 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : loading || !settings ? (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {[0, 1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-72 rounded-xl border border-zinc-200/80 dark:border-white/[0.07] bg-white dark:bg-[#11141B] animate-pulse"
                />
              ))}
            </div>
          ) : (
            <>
              {section === 'review' && (
                <ReviewQueueView
                  clusters={clusters}
                  busyId={busyId}
                  onRename={handleRename}
                  onFetchRenameSuggestions={handleFetchRenameSuggestions}
                  onBatchRename={handleBatchRename}
                  onStatusChange={handleStatusChange}
                  onSyncOne={handleSyncOne}
                  onMerge={handleMerge}
                  onSplit={handleSplit}
                  onOpenLibrary={() => setSection('library')}
                />
              )}

              {section === 'pipeline' && (
                <PipelineLabView
                  summary={pipelineSummary}
                  settings={settings}
                  isRunning={isScanning}
                  onApplyAndRun={(partial) =>
                    handleSaveSettings({ settings: partial, rerun: true })
                  }
                  onClearCacheAndRun={handleClearCacheAndRun}
                  onOpenRules={() => setSection('rules')}
                />
              )}

              {section === 'sync' && (
                <SyncLedgerView
                  clusters={clusters}
                  syncHistory={syncHistory}
                  immichStatus={immichStatus}
                  busyAction={busyId}
                  onSyncCluster={handleSyncOne}
                />
              )}

              {section === 'library' && (
                <LibraryIngestView
                  assets={assets}
                  immichStatus={immichStatus}
                  settings={settings}
                  pullProgress={pullProgress}
                  busyAction={busyId}
                  onUploadPhotos={handleUploadPhotos}
                  onSaveImmichConfig={handleSaveImmichConfig}
                  onTestImmichConfig={handleTestImmichConfig}
                  onDisconnectImmich={handleDisconnectImmich}
                  onIngestImmich={handleIngestImmich}
                  onClearLocalCache={handleClearLocalCache}
                />
              )}

              {section === 'rules' && (
                <RulesDeployView
                  settings={settings}
                  pipelineSummary={pipelineSummary}
                  isBusy={isScanning}
                  onSaveSettings={handleSaveSettings}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Transient Notification Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`animate-toast-in fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-xs font-medium shadow-lg ${
            toast.tone === 'err'
              ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-[#1E1216] dark:text-rose-200'
              : 'border-zinc-200 bg-white text-zinc-900 dark:border-white/[0.10] dark:bg-[#151923] dark:text-zinc-100'
          }`}
        >
          {toast.tone === 'err' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="leading-relaxed">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="ml-1 -mr-1 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
