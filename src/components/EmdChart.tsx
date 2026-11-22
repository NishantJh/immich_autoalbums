import { useId, useState } from 'react';
import type { EmdTimelinePoint } from '../shared/types.ts';
import { ThumbnailImage } from './ThumbnailImage.tsx';

interface EmdChartProps {
  points: EmdTimelinePoint[];
  emdThreshold: number;
  sceneSplitGapMins: number;
  eventName: string;
}

export function EmdChart({
  points,
  emdThreshold,
  sceneSplitGapMins,
  eventName,
}: EmdChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const gradientId = useId();

  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-zinc-200/80 dark:border-white/[0.07] text-sm text-zinc-500 dark:text-zinc-400">
        No chronological frames available for EMD analysis.
      </div>
    );
  }

  const width = 860;
  const height = 250;
  const padL = 48;
  const padR = 20;
  const padT = 24;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxEmd = Math.max(0.75, emdThreshold + 0.15, ...points.map((p) => p.emdScore));
  const xAt = (i: number) =>
    points.length === 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW;
  const yAtEmd = (v: number) => padT + plotH - (Math.min(maxEmd, Math.max(0, v)) / maxEmd) * plotH;
  const yAtLightness = (l: number) => padT + plotH - (Math.min(100, Math.max(0, l)) / 100) * plotH;

  const emdPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAtEmd(p.emdScore).toFixed(1)}`)
    .join(' ');

  const emdArea = `${emdPath} L ${xAt(points.length - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const lightnessPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAtLightness(p.labL).toFixed(1)}`)
    .join(' ');

  const thresholdY = yAtEmd(emdThreshold);
  const activePoint =
    hoveredIdx !== null
      ? points[hoveredIdx]
      : points.find((p) => p.isSplitBoundary) || points[0];
  const activeIdx = hoveredIdx !== null ? hoveredIdx : points.findIndex((p) => p.index === activePoint.index);

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Sliding-Window CIELAB Earth Mover&apos;s Distance — {eventName}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            5-photo rolling histogram shift · Split requires EMD &ge;{' '}
            <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
              {emdThreshold.toFixed(2)}
            </span>{' '}
            and gap &ge;{' '}
            <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
              {sceneSplitGapMins} min
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-[2px] bg-indigo-600 dark:bg-indigo-400" />
            EMD shift
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3.5 bg-amber-500" />
            Mean L* lightness
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-rose-500" />
            Scene split
          </span>
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[560px] h-auto select-none"
          role="img"
          aria-label={`CIELAB EMD chart for ${eventName}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(99, 102, 241)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="rgb(99, 102, 241)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines */}
          {[0, 0.25, 0.5, 0.75].map((tick) => {
            if (tick > maxEmd) return null;
            const y = yAtEmd(tick);
            return (
              <g key={tick}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  className="stroke-zinc-200/80 dark:stroke-white/[0.07]"
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-zinc-400 dark:fill-zinc-500 font-mono text-[10px]"
                >
                  {tick.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Active vertical crosshair */}
          {activeIdx >= 0 && (
            <line
              x1={xAt(activeIdx)}
              y1={padT}
              x2={xAt(activeIdx)}
              y2={padT + plotH}
              className="stroke-zinc-300 dark:stroke-white/[0.14]"
              strokeWidth={1}
            />
          )}

          {/* Threshold line */}
          <line
            x1={padL}
            y1={thresholdY}
            x2={width - padR}
            y2={thresholdY}
            className="stroke-indigo-500/75 dark:stroke-indigo-400/75"
            strokeWidth={1.25}
            strokeDasharray="4 4"
          />
          <text
            x={width - padR - 4}
            y={thresholdY - 6}
            textAnchor="end"
            className="fill-indigo-600 dark:fill-indigo-400 font-mono text-[10px] font-medium"
          >
            Threshold {emdThreshold.toFixed(2)}
          </text>

          {/* EMD gradient area & curve */}
          <path d={emdArea} fill={`url(#${gradientId})`} />
          <path
            d={emdPath}
            fill="none"
            className="stroke-indigo-600 dark:stroke-indigo-400"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Lightness curve */}
          <path
            d={lightnessPath}
            fill="none"
            className="stroke-amber-500/80 dark:stroke-amber-400/80"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />

          {/* Split boundaries and interactive points */}
          {points.map((pt, idx) => {
            const cx = xAt(idx);
            const cy = yAtEmd(pt.emdScore);
            const isActive = activePoint?.index === pt.index;
            return (
              <g key={pt.assetId}>
                {pt.isSplitBoundary && (
                  <g>
                    <line
                      x1={cx}
                      y1={padT}
                      x2={cx}
                      y2={padT + plotH}
                      className="stroke-rose-500"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                    />
                    <text
                      x={Math.min(cx + 5, width - padR - 72)}
                      y={padT + 11}
                      className="fill-rose-600 dark:fill-rose-400 font-mono text-[10px] font-medium"
                    >
                      Split (+{Math.round(pt.gapMinutes)}m)
                    </text>
                  </g>
                )}

                <circle
                  cx={cx}
                  cy={cy}
                  r={pt.isSplitBoundary ? 4.75 : isActive ? 4.5 : 2.75}
                  className={
                    pt.isSplitBoundary
                      ? 'fill-rose-500 stroke-white dark:stroke-[#11141B]'
                      : isActive
                        ? 'fill-indigo-600 dark:fill-indigo-400 stroke-white dark:stroke-[#11141B]'
                        : 'fill-indigo-500/85 dark:fill-indigo-400/85'
                  }
                  strokeWidth={1.75}
                />

                {/* Wide hit area */}
                <rect
                  x={cx - Math.max(8, plotW / (points.length * 2))}
                  y={padT}
                  width={Math.max(16, plotW / points.length)}
                  height={plotH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onClick={() => setHoveredIdx(idx)}
                />

                {/* X-axis frame ticks */}
                {(idx === 0 ||
                  idx === points.length - 1 ||
                  pt.isSplitBoundary ||
                  idx % Math.max(1, Math.floor(points.length / 6)) === 0) && (
                  <text
                    x={cx}
                    y={height - 10}
                    textAnchor="middle"
                    className="fill-zinc-400 dark:fill-zinc-500 font-mono text-[10px]"
                  >
                    #{idx + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Frame Readout */}
      {activePoint && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200/80 dark:border-white/[0.07] pt-3.5 text-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-16 overflow-hidden rounded-md border border-zinc-200/80 dark:border-white/[0.08] shrink-0">
              <ThumbnailImage
                src={`/api/assets/${encodeURIComponent(activePoint.assetId)}/thumbnail`}
                alt={activePoint.fileName}
              />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                Frame #{activePoint.index + 1} · {activePoint.fileName}
              </div>
              <div className="mt-0.5 text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                {new Date(activePoint.timestamp).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'UTC',
                })}{' '}
                UTC · Chapter {activePoint.chapterIndex + 1}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">EMD</span>
              <span
                className={
                  activePoint.isSplitBoundary
                    ? 'font-semibold text-rose-600 dark:text-rose-400'
                    : 'font-semibold text-zinc-900 dark:text-zinc-100'
                }
              >
                {activePoint.emdScore.toFixed(3)}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">Gap</span>
              <span>{activePoint.gapMinutes.toFixed(0)} min</span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">L*</span>
              <span>{activePoint.labL.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">b*</span>
              <span>
                {activePoint.labB >= 0
                  ? `+${activePoint.labB.toFixed(1)} warm`
                  : `${activePoint.labB.toFixed(1)} cool`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
