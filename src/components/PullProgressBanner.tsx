import { Check, Loader2, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PullPhase, PullProgressState } from '../shared/types.ts';

interface PullProgressBannerProps {
  progress: PullProgressState;
  onCancel?: () => Promise<void>;
}

const STEPS: Array<{ id: PullPhase; label: string; order: number }> = [
  { id: 'albums', label: 'Albums', order: 1 },
  { id: 'metadata', label: 'Metadata', order: 2 },
  { id: 'smart_search', label: 'Smart Tags', order: 3 },
  { id: 'thumbnails', label: 'Thumbnails & Color', order: 4 },
  { id: 'clustering', label: 'Clustering', order: 5 },
];

function phaseOrder(phase: PullPhase): number {
  switch (phase) {
    case 'connecting':
      return 0;
    case 'albums':
      return 1;
    case 'metadata':
      return 2;
    case 'smart_search':
      return 3;
    case 'thumbnails':
      return 4;
    case 'saving':
    case 'clustering':
      return 5;
    case 'done':
      return 6;
    default:
      return -1;
  }
}

function formatElapsed(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return '00:00';
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return '00:00';
  const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatEta(etaSeconds: number | null | undefined): string | null {
  if (typeof etaSeconds !== 'number' || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return null;
  }
  if (etaSeconds < 60) return `~${Math.ceil(etaSeconds)}s left`;
  const mins = Math.floor(etaSeconds / 60);
  const secs = Math.round(etaSeconds % 60);
  if (mins < 60) return secs > 0 ? `~${mins}m ${secs}s left` : `~${mins}m left`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `~${hrs}h ${remMins}m left`;
}

export function PullProgressBanner({ progress, onCancel }: PullProgressBannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!progress.active) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [progress.active, progress.startedAt]);

  const currentOrder = phaseOrder(progress.phase);
  const clampedPct = Math.max(2, Math.min(100, progress.percent));
  const etaLabel = formatEta(progress.etaSeconds);

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Immich pull progress"
      className="animate-toast-in rounded-xl border border-indigo-200/90 dark:border-indigo-500/30 bg-white dark:bg-[#11141B] px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {progress.label || 'Pulling from Immich'}
            </div>
            {progress.detail && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate tabular-nums">
                {progress.detail}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {formatElapsed(progress.startedAt, nowMs)}
              {etaLabel ? ` · ${etaLabel}` : ''}
            </span>
            <span className="text-base font-semibold text-indigo-600 dark:text-indigo-400">
              {progress.percent}%
            </span>
          </div>

          {progress.active && onCancel && (
            <button
              type="button"
              disabled={progress.cancelRequested}
              onClick={() => void onCancel()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.10] px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.06] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
            >
              <Square className="h-3 w-3 fill-current" />
              {progress.cancelRequested ? 'Stopping...' : 'Stop & Cluster'}
            </button>
          )}
        </div>
      </div>

      {/* Determinate progress bar (compositor-only scaleX transform) */}
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.07]"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full w-full origin-left rounded-full bg-indigo-600 dark:bg-indigo-400 transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${clampedPct / 100})` }}
        />
      </div>

      {/* Clean unboxed 5-stage progress trail */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {STEPS.map((step, idx) => {
          const isCompleted = currentOrder > step.order;
          const isCurrent = currentOrder === step.order;
          return (
            <div key={step.id} className="flex items-center gap-1.5">
              {idx > 0 && (
                <span aria-hidden="true" className="mr-1.5 text-zinc-300 dark:text-zinc-700">
                  /
                </span>
              )}
              {isCompleted && (
                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span
                className={
                  isCurrent
                    ? 'font-medium text-indigo-600 dark:text-indigo-400'
                    : isCompleted
                      ? 'text-zinc-700 dark:text-zinc-300'
                      : 'text-zinc-400 dark:text-zinc-500'
                }
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
