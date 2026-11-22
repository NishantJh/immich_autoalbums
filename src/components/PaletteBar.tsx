import { useState } from 'react';
import type { PaletteSwatch } from '../shared/types.ts';

interface PaletteBarProps {
  swatches: PaletteSwatch[];
  heightClass?: string;
  interactive?: boolean;
}

export function PaletteBar({
  swatches,
  heightClass = 'h-3',
  interactive = true,
}: PaletteBarProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (!swatches || swatches.length === 0) {
    return (
      <div
        className={`w-full ${heightClass} rounded-sm bg-neutral-200 dark:bg-neutral-800`}
        aria-label="No color palette extracted"
      />
    );
  }

  const totalWeight = swatches.reduce((acc, s) => acc + Math.max(0.05, s.weight), 0);
  const active = activeIdx !== null ? swatches[activeIdx] : null;

  return (
    <div className="w-full">
      <div
        className={`flex w-full overflow-hidden rounded-sm ${heightClass} ring-1 ring-black/5 dark:ring-white/10`}
        role="img"
        aria-label={`Dominant 5-color CIELAB palette: ${swatches.map((s) => s.hex).join(', ')}`}
      >
        {swatches.map((swatch, idx) => {
          const pct = (Math.max(0.05, swatch.weight) / totalWeight) * 100;
          return (
            <button
              key={`${swatch.hex}-${idx}`}
              type="button"
              disabled={!interactive}
              onMouseEnter={() => interactive && setActiveIdx(idx)}
              onMouseLeave={() => interactive && setActiveIdx(null)}
              onFocus={() => interactive && setActiveIdx(idx)}
              onBlur={() => interactive && setActiveIdx(null)}
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                setActiveIdx((prev) => (prev === idx ? null : idx));
              }}
              style={{ width: `${pct}%`, backgroundColor: swatch.hex }}
              className="h-full transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              title={`${swatch.hex} · L* ${swatch.l} a* ${swatch.a} b* ${swatch.b} (${Math.round(swatch.weight * 100)}%)`}
            />
          );
        })}
      </div>

      {interactive && active && (
        <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px] ring-1 ring-black/15"
              style={{ backgroundColor: active.hex }}
            />
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {active.hex}
            </span>
          </span>
          <span>
            L*{active.l.toFixed(0)} a*{active.a.toFixed(0)} b*{active.b.toFixed(0)} ·{' '}
            {Math.round(active.weight * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
