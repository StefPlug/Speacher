import { Clock, Copy, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { HistoryEntry } from '../lib/types';

type Props = {
  entries: HistoryEntry[];
  onDelete: (id: string) => void;
  onClear: () => void;
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryPanel({ entries, onDelete, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.clean.toLowerCase().includes(needle) || entry.raw.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  async function copy(entry: HistoryEntry) {
    try {
      await navigator.clipboard.writeText(entry.clean);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <section className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink-500">
          <Clock size={14} />
          История
          <span className="text-ink-400">({entries.length})</span>
        </h2>
        {entries.length > 0 ? (
          <div className="flex items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по тексту"
              className="w-40 rounded-full border border-ink-900/10 bg-transparent px-3 py-1.5 text-[12px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900/30 focus:outline-none sm:w-52"
              aria-label="Поиск по истории"
            />
            <button
              type="button"
              onClick={onClear}
              className="text-[12px] text-ink-400 underline decoration-ink-900/15 underline-offset-4 transition hover:text-ink-900"
            >
              Очистить
            </button>
          </div>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-ink-900/15 px-5 py-8 text-center text-[13px] text-ink-400">
          Пока пусто. Первая диктовка появится здесь.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-ink-900/15 px-5 py-8 text-center text-[13px] text-ink-400">
          Ничего не нашлось.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((entry) => (
            <li
              key={entry.id}
              className="group rounded-2xl border border-ink-900/8 bg-white/50 p-3.5 transition hover:border-ink-900/15 hover:bg-white/80"
            >
              <div className="flex items-center justify-between gap-3 text-[11px] text-ink-400">
                <span className="flex items-center gap-2">
                  <span>{formatDate(entry.createdAt)}</span>
                  <span className="text-ink-900/15">·</span>
                  <span>{(entry.durationMs / 1000).toFixed(1)} с</span>
                  {entry.pending ? (
                    <span className="rounded-full bg-rose-300/60 px-1.5 py-0.5 text-[10px] text-ink-900">
                      не отправлено
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => void copy(entry)}
                    className="grid h-6 w-6 place-items-center rounded-full text-ink-400 transition hover:bg-ink-900/5 hover:text-ink-900"
                    aria-label="Скопировать текст"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(entry.id)}
                    className="grid h-6 w-6 place-items-center rounded-full text-ink-400 transition hover:bg-ink-900/5 hover:text-ink-900"
                    aria-label="Удалить запись"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-900">
                {copiedId === entry.id ? 'Скопировано в буфер' : entry.clean}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
