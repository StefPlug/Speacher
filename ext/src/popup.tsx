import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Waveform } from '../../src/components/Waveform';
import { DEFAULT_SETTINGS, type SpeacherSettings } from '../../shared/settings';
import '../../src/index.css';

type PopupState = {
  phase: 'idle' | 'recording' | 'processing' | 'error' | 'done';
  elapsedMs: number;
  text: string;
  fallback: boolean;
  message: string;
  hasKey: boolean;
  notice: string | null;
};

const EMPTY: PopupState = {
  phase: 'idle',
  elapsedMs: 0,
  text: '',
  fallback: false,
  message: '',
  hasKey: false,
  notice: null,
};

async function call<T>(message: unknown): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function Popup() {
  const [state, setState] = useState<PopupState>(EMPTY);
  const [settings, setSettings] = useState<SpeacherSettings>(DEFAULT_SETTINGS);
  const [level, setLevel] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.local.get('settings');
      setSettings({ ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) });
      setState(await call<PopupState>({ type: 'get-state' }));
    })();
  }, []);

  // Опрос состояния, пока открыт попап: service worker — единственный источник правды.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const next = await call<PopupState>({ type: 'get-state' });
      if (!cancelled) setState(next);
    };
    const id = window.setInterval(() => void poll(), 350);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Уровень микрофона для волны: берём из offscreen через фоновый релей.
  useEffect(() => {
    if (state.phase !== 'recording') {
      setLevel(0.05);
      return;
    }
    const id = window.setInterval(() => {
      void chrome.runtime
        .sendMessage({ type: 'level' })
        .then((value) => {
          const payload = value as { level?: number } | undefined;
          if (typeof payload?.level === 'number') setLevel(payload.level);
        })
        .catch(() => undefined);
    }, 110);
    return () => window.clearInterval(id);
  }, [state.phase]);

  const recording = state.phase === 'recording';
  const busy = state.phase === 'processing';

  async function copy() {
    if (!state.text) return;
    try {
      await navigator.clipboard.writeText(state.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⇧Space' : 'Ctrl+Shift+Space';

  return (
    <div className="w-[352px] bg-cream-100 p-4 text-ink-900">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-ink-900">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <g fill="#F5C6D6">
                <rect x="1.5" y="9.5" width="2" height="5" rx="1" />
                <rect x="5.5" y="6.5" width="2" height="11" rx="1" />
                <rect x="9.5" y="3.5" width="2" height="17" rx="1" />
                <rect x="13.5" y="7" width="2" height="10" rx="1" />
                <rect x="17.5" y="9" width="2" height="6" rx="1" />
                <rect x="21" y="10.5" width="1.5" height="3" rx="0.75" />
              </g>
            </svg>
          </span>
          <span className="text-[13px] font-semibold">Speacher</span>
        </div>
        <button
          type="button"
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="rounded-full px-2 py-1 text-[11px] text-ink-500 transition hover:bg-ink-900/5 hover:text-ink-900"
        >
          Настройки
        </button>
      </header>

      {!state.hasKey ? (
        <div className="mb-3 rounded-2xl border border-ink-900/10 bg-white/70 p-3">
          <p className="text-[12px] leading-relaxed text-ink-900">
            Нужен ключ Groq. Он бесплатный и хранится только в этом браузере.
          </p>
          <button
            type="button"
            onClick={() => void chrome.runtime.openOptionsPage()}
            className="mt-2 w-full rounded-full bg-ink-900 px-3 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-700"
          >
            Вставить ключ
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl bg-ink-900 p-3 text-cream-50">
        <div className="flex items-center gap-3">
          <Waveform level={level} active={recording} busy={busy} bars={20} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-cream-100/85">
              {recording
                ? 'Слушаю…'
                : busy
                  ? 'Распознаём…'
                  : state.phase === 'error'
                    ? 'Ошибка'
                    : 'Готов диктовать'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-cream-100/45">
              {recording ? 'Enter — готово · Esc — отмена' : shortcut}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || !state.hasKey}
          onClick={() => void call({ type: recording ? 'stop' : 'start' })}
          className="mt-3 w-full rounded-full bg-rose-300 px-3 py-2.5 text-[13px] font-medium text-ink-900 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recording ? 'Завершить и вставить' : busy ? 'Обрабатываю…' : 'Начать диктовку'}
        </button>
      </div>

      {recording ? (
        <button
          type="button"
          onClick={() => void call({ type: 'cancel' })}
          className="mt-2 w-full rounded-full border border-ink-900/12 px-3 py-2 text-[12px] text-ink-500 transition hover:border-ink-900/30 hover:text-ink-900"
        >
          Отменить
        </button>
      ) : null}

      {state.phase === 'error' && state.message ? (
        <p className="mt-3 rounded-2xl border border-ink-900/10 bg-white/70 p-3 text-[12px] leading-relaxed text-ink-900">
          {state.message}
        </p>
      ) : null}

      {state.phase === 'done' && state.text ? (
        <div className="mt-3 rounded-2xl border border-ink-900/10 bg-white/70 p-3">
          <p className="line-clamp-4 text-[12px] leading-relaxed text-ink-900">{state.text}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex-1 rounded-full bg-ink-900 px-3 py-1.5 text-[11px] font-medium text-cream-50 transition hover:bg-ink-700"
            >
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
            <button
              type="button"
              onClick={() => void call({ type: 'insert-last' })}
              className="flex-1 rounded-full border border-ink-900/15 px-3 py-1.5 text-[11px] text-ink-900 transition hover:border-ink-900/40"
            >
              Вставить в поле
            </button>
          </div>
        </div>
      ) : null}

      {state.notice ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{state.notice}</p>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-ink-400">
        Пилюля на странице:{' '}
        <button
          type="button"
          className="underline decoration-ink-900/20 underline-offset-2"
          onClick={() =>
            void (async () => {
              const next = { ...settings, showPill: !settings.showPill };
              setSettings(next);
              await chrome.storage.local.set({ settings: next });
            })()
          }
        >
          {settings.showPill ? 'включена' : 'выключена'}
        </button>
      </p>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<Popup />);
}
