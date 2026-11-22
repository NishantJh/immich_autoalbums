import { Check } from 'lucide-react';
import { useState } from 'react';
import type { PaletteSwatch } from '../shared/types.ts';

interface PaletteBarProps {
  swatches: PaletteSwatch[];
  heightClass?: string;
  interactive?: boolean;
  showLegend?: boolean;
}

export function PaletteBar({
  swatches,
  heightClass = 'h-3',
  interactive = true,
  showLegend = false,
}: PaletteBarProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  if (!swatches || swatches.length === 0) {
    return (
      <div
        className={`w-full ${heightClass} rounded-[4px] bg-zinc-200/80 dark:bg-white/[0.06]`}
        aria-label="No color palette extracted"
      />
    );
  }

  const totalWeight = swatches.reduce((acc, s) => acc + Math.max(0.05, s.weight), 0);
  const active = activeIdx !== null ? swatches[activeIdx] : null;

  const handleCopy = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex((curr) => (curr === hex ? null : curr)), 1400);
    } catch {
      // Clipboard unavailable in restricted contexts; selection readout still works
    }
  };

  return (
    <div className="w-full">
      <div
        className={`flex w-full overflow-hidden rounded-[4px] ${heightClass} ring-1 ring-black/[0.08] dark:ring-white/[0.10]`}
        role="img"
        aria-label={`Dominant 5-color CIELAB palette: ${swatches.map((s) => s.hex).join(', ')}`}
      >
        {swatches.map((swatch, idx) => {
          const pct = (Math.max(0.05, swatch.weight) / totalWeight) * 100;
          const isFocused = activeIdx === idx;
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
                setActiveIdx(idx);
                void handleCopy(swatch.hex);
              }}
              style={{ width: `${pct}%`, backgroundColor: swatch.hex }}
              className={`h-full transition-[opacity,filter] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                interactive ? 'cursor-pointer hover:brightness-105' : 'cursor-default'
              } ${activeIdx !== null && !isFocused ? 'opacity-80' : 'opacity-100'}`}
              title={
                interactive
                  ? `${swatch.hex} · L*${swatch.l} a*${swatch.a} b*${swatch.b} (${Math.round(swatch.weight * 100)}%) — click to copy`
                  : `${swatch.hex} (${Math.round(swatch.weight * 100)}%)`
              }
            />
          );
        })}
      </div>

      {interactive && (
        <div className="mt-1.5 flex min-h-[18px] items-center justify-between text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
          {active ? (
            <>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[2px] ring-1 ring-black/15 dark:ring-white/20"
                  style={{ backgroundColor: active.hex }}
                />
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {active.hex.toUpperCase()}
                </span>
                {copiedHex === active.hex && (
                  <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </span>
              <span>
                L*{active.l.toFixed(0)} a*{active.a.toFixed(0)} b*{active.b.toFixed(0)} ·{' '}
                {Math.round(active.weight * 100)}%
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-2 overflow-hidden">
                {swatches.slice(0, 5).map((s, i) => (
                  <span key={`${s.hex}-${i}`} className="inline-flex items-center gap-1 truncate">
                    <span
                      className="inline-block h-2 w-2 rounded-[2px] ring-1 ring-black/10 dark:ring-white/15 shrink-0"
                      style={{ backgroundColor: s.hex }}
                    />
                    <span className="hidden sm:inline">{s.hex.toUpperCase()}</span>
                  </span>
                ))}
              </span>
              <span className="text-[10px] font-sans text-zinc-400 dark:text-zinc-500 shrink-0">
                Click swatch to copy
              </span>
            </>
          )}
        </div>
      )}

      {showLegend && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {swatches.map((swatch, idx) => (
            <button
              key={`legend-${swatch.hex}-${idx}`}
              type="button"
              onClick={() => void handleCopy(swatch.hex)}
              className="group flex flex-col items-start rounded-md border border-zinc-200/80 dark:border-white/[0.07] bg-white dark:bg-[#0D1017] p-2 text-left transition-colors hover:border-zinc-300 dark:hover:border-white/20"
            >
              <span
                className="h-5 w-full rounded-[3px] ring-1 ring-black/10 dark:ring-white/10"
                style={{ backgroundColor: swatch.hex }}
              />
              <span className="mt-1.5 font-mono text-[11px] font-medium text-zinc-900 dark:text-zinc-100">
                {copiedHex === swatch.hex ? 'Copied' : swatch.hex.toUpperCase()}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {Math.round(swatch.weight * 100)}% · L*{swatch.l.toFixed(0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
