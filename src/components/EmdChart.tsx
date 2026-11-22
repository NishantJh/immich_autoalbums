import { useState } from 'react';
import type { EmdTimelinePoint } from '../shared/types.ts';

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

  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center border border-neutral-200 dark:border-neutral-800 rounded-lg text-sm text-neutral-500">
        No chronological frames available for EMD analysis.
      </div>
    );
  }

  const width = 820;
  const height = 240;
  const padL = 46;
  const padR = 20;
  const padT = 22;
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
  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : points.find((p) => p.isSplitBoundary) || points[0];

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Sliding-Window CIELAB Earth Mover&apos;s Distance — {eventName}
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            5-photo rolling histogram distance · Split requires EMD &ge; {emdThreshold.toFixed(2)} and gap &ge; {sceneSplitGapMins} min
          </p>
        </div>

        <div className="flex items-center gap-5 text-xs text-neutral-600 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-[1px] bg-indigo-600 dark:bg-indigo-400" />
            EMD shift
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-amber-500" />
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
                  className="stroke-neutral-200 dark:stroke-neutral-800"
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-neutral-400 dark:fill-neutral-500 font-mono text-[10px]"
                >
                  {tick.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Threshold line */}
          <line
            x1={padL}
            y1={thresholdY}
            x2={width - padR}
            y2={thresholdY}
            className="stroke-indigo-500/70 dark:stroke-indigo-400/70"
            strokeWidth={1.25}
            strokeDasharray="4 4"
          />
          <text
            x={width - padR - 4}
            y={thresholdY - 5}
            textAnchor="end"
            className="fill-indigo-600 dark:fill-indigo-400 font-mono text-[10px]"
          >
            Threshold {emdThreshold.toFixed(2)}
          </text>

          {/* EMD area & curve */}
          <path d={emdArea} className="fill-indigo-600/10 dark:fill-indigo-400/12" />
          <path
            d={emdPath}
            fill="none"
            className="stroke-indigo-600 dark:stroke-indigo-400"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Lightness curve */}
          <path
            d={lightnessPath}
            fill="none"
            className="stroke-amber-500/80 dark:stroke-amber-400/80"
            strokeWidth={1.5}
            strokeDasharray="2 2"
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
                      x={cx + 4}
                      y={padT + 10}
                      className="fill-rose-600 dark:fill-rose-400 font-mono text-[10px] font-medium"
                    >
                      Split (+{Math.round(pt.gapMinutes)}m)
                    </text>
                  </g>
                )}

                <circle
                  cx={cx}
                  cy={cy}
                  r={pt.isSplitBoundary ? 4.5 : isActive ? 4 : 2.75}
                  className={
                    pt.isSplitBoundary
                      ? 'fill-rose-500 stroke-white dark:stroke-neutral-950'
                      : isActive
                        ? 'fill-indigo-600 dark:fill-indigo-400 stroke-white dark:stroke-neutral-950'
                        : 'fill-indigo-500/80 dark:fill-indigo-400/80'
                  }
                  strokeWidth={1.5}
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
                {(idx === 0 || idx === points.length - 1 || pt.isSplitBoundary || idx % Math.max(1, Math.floor(points.length / 6)) === 0) && (
                  <text
                    x={cx}
                    y={height - 10}
                    textAnchor="middle"
                    className="fill-neutral-400 dark:fill-neutral-500 font-mono text-[10px]"
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-neutral-200 dark:border-neutral-800 pt-3 text-xs">
          <div className="flex items-center gap-3">
            <img
              src={`/api/assets/${encodeURIComponent(activePoint.assetId)}/thumbnail`}
              alt={activePoint.fileName}
              referrerPolicy="no-referrer"
              className="h-10 w-14 rounded object-cover border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
            />
            <div>
              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                Frame #{activePoint.index + 1} · {activePoint.fileName}
              </div>
              <div className="text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
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

          <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
            <div>
              <span className="text-neutral-400 mr-1.5">EMD</span>
              <span
                className={
                  activePoint.isSplitBoundary
                    ? 'font-semibold text-rose-600 dark:text-rose-400'
                    : 'font-semibold text-neutral-900 dark:text-neutral-100'
                }
              >
                {activePoint.emdScore.toFixed(3)}
              </span>
            </div>
            <div>
              <span className="text-neutral-400 mr-1.5">Gap</span>
              <span>{activePoint.gapMinutes.toFixed(0)} min</span>
            </div>
            <div>
              <span className="text-neutral-400 mr-1.5">L*</span>
              <span>{activePoint.labL.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-neutral-400 mr-1.5">b*</span>
              <span>
                {activePoint.labB >= 0 ? `+${activePoint.labB.toFixed(1)} warm` : `${activePoint.labB.toFixed(1)} cool`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
