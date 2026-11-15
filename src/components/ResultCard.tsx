import { Check, Copy, CornerDownLeft, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Style } from '../lib/types';
import { STYLE_LABELS } from '../lib/types';

type Props = {
  text: string;
  raw: string;
  style: Style;
  fallback: boolean;
  timing: { asrMs?: number; formatMs?: number; totalMs?: number };
  error: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onStyleChange: (style: Style) => void;
  onInsert: () => void;
  insertTarget: string | null;
};

export function ResultCard({
  text,
  raw,
  style,
  fallback,
  timing,
  error,
  canRetry,
  onRetry,
  onStyleChange,
  onInsert,
  insertTarget,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const latency = [
    timing.asrMs !== undefined ? `ASR ${(timing.asrMs / 1000).toFixed(2)} с` : null,
    timing.formatMs !== undefined ? `чистка ${(timing.formatMs / 1000).toFixed(2)} с` : null,
    timing.totalMs !== undefined ? `итого ${(timing.totalMs / 1000).toFixed(2)} с` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (error) {
    return (
      <section className="w-full rounded-3xl border border-ink-900/10 bg-white/60 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-900 text-rose-200">
            <TriangleAlert size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] leading-relaxed text-ink-900">{error}</p>
            {canRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium text-cream-50 transition hover:bg-ink-700"
              >
                <RotateCcw size={13} />
                Повторить
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  if (!text) return null;

  return (
    <section className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Стиль текста">
          {(Object.keys(STYLE_LABELS) as Style[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onStyleChange(key)}
              aria-pressed={style === key}
              className={[
                'rounded-full px-3 py-1.5 text-[12px] transition',
                style === key
                  ? 'bg-ink-900 text-cream-50'
                  : 'bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 hover:text-ink-900',
              ].join(' ')}
            >
              {STYLE_LABELS[key]}
            </button>
          ))}
        </div>
        <span className="text-[11px] tabular-nums text-ink-400">{latency}</span>
      </div>

      <div className="relative rounded-3xl border border-ink-900/10 bg-white/70 p-5 shadow-[0_1px_0_rgb(255_255_255/0.8)_inset]">
        <p className="whitespace-pre-wrap text-[17px] leading-[1.65] text-ink-900">{text}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-900/10 pt-3">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-3.5 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-700"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>

          {insertTarget ? (
            <button
              type="button"
              onClick={onInsert}
              className="inline-flex items-center gap-2 rounded-full border border-ink-900/15 px-3.5 py-2 text-[12px] font-medium text-ink-900 transition hover:border-ink-900/40"
            >
              <CornerDownLeft size={13} />
              Вставить в «{insertTarget}»
            </button>
          ) : null}

          {raw && raw !== text ? (
            <button
              type="button"
              onClick={() => setShowRaw((value) => !value)}
              className="ml-auto text-[12px] text-ink-500 underline decoration-ink-900/20 underline-offset-4 transition hover:text-ink-900"
            >
              {showRaw ? 'Скрыть расшифровку' : 'Что было сказано дословно'}
            </button>
          ) : null}
        </div>

        {showRaw && raw && raw !== text ? (
          <p className="mt-3 rounded-2xl bg-cream-200/70 p-3 text-[13px] leading-relaxed text-ink-500">
            {raw}
          </p>
        ) : null}

        {fallback ? (
          <p className="mt-3 text-[11px] text-ink-400">
            Чистка не применилась — оставлен дословный текст.
          </p>
        ) : null}
      </div>
    </section>
  );
}
