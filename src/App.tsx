import { Settings2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryPanel } from './components/HistoryPanel';
import { RecordingPill } from './components/RecordingPill';
import { ResultCard } from './components/ResultCard';
import { SettingsPanel } from './components/SettingsPanel';
import { useRecorder } from './hooks/useRecorder';
import { GroqClientError, reformat, runDictation } from './lib/api';
import { clearHistory, loadHistory, loadSettings, saveHistory, saveSettings } from './lib/storage';
import type {
  HistoryEntry,
  SpeacherSettings,
  Stage,
  Style,
  Timing,
} from './lib/types';
import { DEFAULT_SETTINGS } from './lib/types';

type ResultState = {
  text: string;
  raw: string;
  style: Style;
  fallback: boolean;
  timing: Timing;
  entryId: string | null;
};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [settings, setSettings] = useState<SpeacherSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [insertTarget, setInsertTarget] = useState<HTMLElement | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const lastRecording = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const focusTargetRef = useRef<HTMLElement | null>(null);

  const recorder = useRecorder();
  const hasKey = settings.apiKey.trim().length > 0;

  useEffect(() => {
    setSettings(loadSettings());
    setHistory(loadHistory());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSettings(settings);
  }, [settings, hydrated]);

  useEffect(() => {
    if (hydrated && settings.saveHistory) saveHistory(history);
  }, [history, settings.saveHistory, hydrated]);

  useEffect(() => {
    if (hydrated && !settings.saveHistory) return;
  }, [settings.saveHistory, hydrated]);

  const updateSettings = useCallback((patch: Partial<SpeacherSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const describeInsertTarget = (element: HTMLElement | null): string | null => {
    if (!element) return null;
    const aria = element.getAttribute('aria-label') ?? element.getAttribute('placeholder');
    if (aria) return aria.length > 28 ? `${aria.slice(0, 28)}…` : aria;
    if (element instanceof HTMLTextAreaElement) return 'текстовое поле';
    if (element instanceof HTMLInputElement) return 'поле ввода';
    return 'поле на странице';
  };

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;
      if (editable && !target.closest('[data-no-insert]')) {
        focusTargetRef.current = target;
        setInsertTarget(target);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const addHistory = useCallback((entry: HistoryEntry) => {
    setHistory((current) => [entry, ...current].slice(0, 100));
  }, []);

  const patchHistory = useCallback((entryId: string, patch: Partial<HistoryEntry>) => {
    setHistory((current) =>
      current.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const processRecording = useCallback(
    async (blob: Blob, durationMs: number) => {
      setError(null);
      setResult(null);
      lastRecording.current = { blob, durationMs };
      const startedAt = performance.now();

      if (!hasKey) {
        setStage('error');
        setError('Ключ Groq не задан. Откройте настройки и вставьте ключ — он бесплатный.');
        setSettingsOpen(true);
        return;
      }

      setStage('transcribing');
      setStatusText('Распознаём речь…');

      try {
        const outcome = await runDictation({
          blob,
          settings,
          modelChoice: settings.asrModel === 'whisper-large-v3' ? 'accurate' : 'turbo',
        });

        setStage('done');
        setStatusText('');
        if (outcome.notice) setError(outcome.notice);

        const entryId = newId();
        setResult({
          text: outcome.clean,
          raw: outcome.raw,
          style: settings.style,
          fallback: outcome.fallback,
          timing: {
            asrMs: outcome.asrMs,
            formatMs: outcome.formatMs ?? undefined,
            totalMs: Math.round(performance.now() - startedAt),
          },
          entryId,
        });

        addHistory({
          id: entryId,
          createdAt: Date.now(),
          raw: outcome.raw,
          clean: outcome.clean,
          style: settings.style,
          language: outcome.language,
          durationMs,
          asrMs: outcome.asrMs,
          formatMs: outcome.formatMs,
          fallback: outcome.fallback,
          host: null,
        });

        playChime();
      } catch (caught) {
        setStage('error');
        setStatusText('');
        const message =
          caught instanceof GroqClientError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : 'Не удалось распознать речь.';
        setError(message);
        if (caught instanceof GroqClientError && caught.code === 'no_key') setSettingsOpen(true);
      }
    },
    [addHistory, hasKey, settings],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    setStage('recording');
    setStatusText('');
    await recorder.start();
  }, [recorder]);

  const stopAndProcess = useCallback(async () => {
    try {
      const recording = await recorder.stop();
      await processRecording(recording.blob, recording.durationMs);
    } catch (caught) {
      setStage('error');
      setError(caught instanceof Error ? caught.message : 'Запись не удалась.');
    }
  }, [processRecording, recorder]);

  const cancelRecording = useCallback(() => {
    recorder.cancel();
    setStage('idle');
  }, [recorder]);

  useEffect(() => {
    if (recorder.state === 'recording' && (stage === 'idle' || stage === 'done')) {
      setStage('recording');
    }
  }, [recorder.state, stage]);

  const retry = useCallback(() => {
    const previous = lastRecording.current;
    if (!previous) {
      setError(null);
      setStage('idle');
      return;
    }
    void processRecording(previous.blob, previous.durationMs);
  }, [processRecording]);

  const reapplyStyle = useCallback(
    async (style: Style) => {
      if (!result) return;
      updateSettings({ style });
      if (!settings.cleanup) return;
      setStage('formatting');
      setStatusText('Меняем стиль…');
      try {
        const formatted = await reformat({ raw: result.raw, style, settings });
        setResult({ ...result, text: formatted.text, style, fallback: formatted.fallback });
        if (result.entryId) patchHistory(result.entryId, { clean: formatted.text, style });
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Не удалось применить стиль.');
      } finally {
        setStage('done');
        setStatusText('');
      }
    },
    [patchHistory, result, settings, updateSettings],
  );

  const insertIntoPage = useCallback(() => {
    const target = focusTargetRef.current;
    if (!target || !result) return;
    let inserted = false;

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      target.focus();
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.setRangeText(result.text, start, end, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      inserted = true;
    } else if (target.isContentEditable) {
      target.focus();
      inserted = document.execCommand('insertText', false, result.text);
    }

    if (!inserted) {
      void navigator.clipboard.writeText(result.text);
      setError('Вставка не удалась — текст скопирован в буфер обмена.');
    }
  }, [result]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.code === 'Space') {
        event.preventDefault();
        if (stage === 'recording') void stopAndProcess();
        else if (stage === 'idle' || stage === 'done' || stage === 'error') void startRecording();
        return;
      }
      if (stage === 'recording' && event.key === 'Escape') {
        event.preventDefault();
        cancelRecording();
        return;
      }
      if (stage === 'recording' && event.key === 'Enter' && !event.shiftKey) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('button')) return;
        event.preventDefault();
        void stopAndProcess();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelRecording, stage, startRecording, stopAndProcess]);

  return (
    <div className="min-h-dvh bg-cream-100 text-ink-900">
      <header className="mx-auto flex max-w-[880px] items-center justify-between px-5 pt-6 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink-900">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Speacher</span>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-ink-900/12 px-3.5 py-2 text-[12px] text-ink-500 transition hover:border-ink-900/30 hover:text-ink-900"
          data-no-insert
        >
          <Settings2 size={13} />
          Настройки
        </button>
      </header>

      <main className="mx-auto flex max-w-[880px] flex-col items-center px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <div className="mb-8 max-w-[640px] text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-ink-900/5 px-3 py-1 text-[11px] text-ink-500">
            <Sparkles size={11} />
            Whisper Large v3 · {settings.asrModel === 'whisper-large-v3' ? 'Large v3' : 'Turbo'}
          </p>
          <h1 className="display text-[clamp(38px,7vw,64px)] text-ink-900">
            Не печатай,
            <br />
            <em className="italic">просто скажи.</em>
          </h1>
          <p className="mx-auto mt-4 max-w-[440px] text-[14px] leading-relaxed text-ink-500 sm:text-[15px]">
            Говорите как думаете. Speacher уберёт «э-э», оговорки и самокоррекции, расставит
            пунктуацию и отдаст готовый текст.
          </p>
        </div>

        <RecordingPill
          stage={stage === 'recording' ? 'recording' : stage}
          level={recorder.level}
          elapsedMs={recorder.elapsedMs}
          statusText={statusText}
          onStart={() => void startRecording()}
          onStop={() => void stopAndProcess()}
          onCancel={cancelRecording}
          disabled={false}
        />

        {!hasKey ? (
          <div className="mt-4 max-w-[520px] rounded-2xl border border-ink-900/10 bg-white/60 px-4 py-3 text-center text-[12px] leading-relaxed text-ink-500">
            Чтобы диктовать, вставьте свой ключ Groq — он бесплатный.{' '}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="underline decoration-ink-900/25 underline-offset-4 hover:text-ink-900"
            >
              Открыть настройки
            </button>
          </div>
        ) : null}

        {recorder.error ? (
          <div className="mt-4 max-w-[520px] rounded-2xl border border-ink-900/10 bg-white/60 px-4 py-3 text-center text-[12px] leading-relaxed text-ink-500">
            {recorder.error}
          </div>
        ) : null}

        <div className="mt-8 flex w-full justify-center">
          <div className="w-full max-w-[680px]">
            <ResultCard
              text={result?.text ?? ''}
              raw={result?.raw ?? ''}
              style={result?.style ?? settings.style}
              fallback={result?.fallback ?? false}
              timing={result?.timing ?? {}}
              error={error}
              canRetry={lastRecording.current !== null}
              onRetry={retry}
              onStyleChange={(style) => void reapplyStyle(style)}
              onInsert={insertIntoPage}
              insertTarget={insertTarget ? describeInsertTarget(insertTarget) : null}
            />
          </div>
        </div>

        <div className="mt-12 w-full max-w-[680px]">
          <HistoryPanel
            entries={history}
            onDelete={(id) => setHistory((current) => current.filter((entry) => entry.id !== id))}
            onClear={() => {
              setHistory([]);
              clearHistory();
            }}
          />
        </div>

        <footer className="mt-16 max-w-[560px] text-center text-[11px] leading-relaxed text-ink-400">
          Сервера нет: аудио уходит из браузера прямо в Groq и не сохраняется. Ключ, история и
          словарь живут только в этом браузере. Для диктовки в любом приложении есть{' '}
          <a
            href="https://github.com/StefPlug/Speacher"
            className="underline decoration-ink-900/20 underline-offset-4 hover:text-ink-900"
            target="_blank"
            rel="noreferrer"
          >
            расширение
          </a>
          .
        </footer>
      </main>

      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Короткий сигнал окончания обработки: два тихих тона через Web Audio. */
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    gain.connect(ctx.destination);

    [880, 1320].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start(now + index * 0.07);
      osc.stop(now + 0.3);
    });

    window.setTimeout(() => void ctx.close(), 600);
  } catch {
    // Звук — необязательное украшение.
  }
}
