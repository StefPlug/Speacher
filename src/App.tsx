import { Settings2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryPanel } from './components/HistoryPanel';
import { RecordingPill } from './components/RecordingPill';
import { ResultCard } from './components/ResultCard';
import { SettingsPanel } from './components/SettingsPanel';
import { useRecorder } from './hooks/useRecorder';
import {
  formatText,
  getHealth,
  transcribeAudio,
  type HealthResponse,
  type TranscribeResponse,
} from './lib/api';
import { clearHistory, loadHistory, loadSettings, saveHistory, saveSettings } from './lib/storage';
import {
  DEFAULT_SETTINGS,
  type ApiError,
  type HistoryEntry,
  type Settings,
  type Stage,
  type Style,
  type Timing,
} from './lib/types';

type ResultState = {
  text: string;
  raw: string;
  style: Style;
  fallback: boolean;
  timing: Timing;
  entryId: string | null;
};

const EMPTY_SETTINGS: Settings = DEFAULT_SETTINGS;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [insertTarget, setInsertTarget] = useState<HTMLElement | null>(null);

  const lastRecording = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const focusTargetRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const recorder = useRecorder();

  // Настройки и история поднимаются один раз на клиенте.
  useEffect(() => {
    setSettings(loadSettings());
    setHistory(loadHistory());
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (settings !== EMPTY_SETTINGS) saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (settings.saveHistory) saveHistory(history);
  }, [history, settings.saveHistory]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const describeInsertTarget = (element: HTMLElement | null): string | null => {
    if (!element) return null;
    const aria = element.getAttribute('aria-label') ?? element.getAttribute('placeholder');
    if (aria) return aria.length > 28 ? `${aria.slice(0, 28)}…` : aria;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.tagName === 'TEXTAREA' ? 'текстовое поле' : 'поле ввода';
    }
    return 'поле на странице';
  };

  // Запоминаем последнее поле, куда пользователь поставил курсор.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const editable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable;
        if (editable && !target.closest('[data-no-insert]')) {
          focusTargetRef.current = target;
          setInsertTarget(target);
        }
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const addHistory = useCallback(
    (entry: HistoryEntry) => {
      setHistory((current) => [entry, ...current].slice(0, 60));
    },
    [],
  );

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
      const localId = newId();

      setStage('transcribing');
      setStatusText('Распознаём речь…');

      let asr: TranscribeResponse;
      try {
        asr = await transcribeAudio({
          blob,
          durationMs,
          language: settings.language,
          model: settings.model,
          vocabulary: settings.vocabulary,
        });
      } catch (caught) {
        const apiError = caught as ApiError;
        setStage('error');
        setStatusText('');
        setError(apiError?.message ?? 'Не удалось распознать речь.');
        // Сохраняем саму запись в историю, чтобы её можно было отправить позже.
        addHistory({
          id: localId,
          createdAt: Date.now(),
          raw: '',
          clean: '',
          style: settings.style,
          language: null,
          model: settings.model,
          durationMs,
          timing: {},
          fallback: false,
          pending: true,
          audioError: apiError?.message,
        });
        return;
      }

      const asrMs = asr.latencyMs;
      let clean = asr.text;
      let fallback = false;
      let formatMs = 0;

      if (settings.cleanup) {
        setStage('formatting');
        setStatusText('Приводим текст в порядок…');
        try {
          const formatted = await formatText({
            text: asr.text,
            style: settings.style,
            language: settings.language,
            vocabulary: settings.vocabulary,
          });
          clean = formatted.text;
          fallback = formatted.fallback;
          formatMs = formatted.latencyMs;
          if (formatted.fallback && formatted.message) {
            setError(`Чистка не удалась: ${formatted.message}`);
          }
        } catch (caught) {
          const apiError = caught as ApiError;
          fallback = true;
          setError(apiError?.message ?? 'Чистка недоступна — оставлен дословный текст.');
        }
      }

      const timing: Timing = {
        asrMs,
        formatMs: formatMs || undefined,
        totalMs: Math.round(performance.now() - startedAt),
      };

      setStage('done');
      setStatusText('');
      setResult({
        text: clean,
        raw: asr.text,
        style: settings.style,
        fallback,
        timing,
        entryId: localId,
      });

      addHistory({
        id: localId,
        createdAt: Date.now(),
        raw: asr.text,
        clean,
        style: settings.style,
        language: asr.detectedLanguage,
        model: asr.model,
        durationMs,
        timing,
        fallback,
        pending: false,
      });

      // Мягкий звук завершения — короткий, ненавязчивый.
      playChime();
    },
    [addHistory, settings.cleanup, settings.language, settings.model, settings.style, settings.vocabulary],
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

  // Синхронизируем внутреннее состояние рекордера с общим состоянием экрана.
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
        const formatted = await formatText({
          text: result.raw,
          style,
          language: settings.language,
          vocabulary: settings.vocabulary,
        });
        setResult({ ...result, text: formatted.text, style, fallback: formatted.fallback });
        if (result.entryId) {
          patchHistory(result.entryId, { clean: formatted.text, style });
        }
        setError(null);
      } catch (caught) {
        const apiError = caught as ApiError;
        setError(apiError?.message ?? 'Не удалось применить стиль.');
      } finally {
        setStage('done');
        setStatusText('');
      }
    },
    [patchHistory, result, settings.cleanup, settings.language, settings.vocabulary, updateSettings],
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

  // Горячие клавиши: старт/стоп диктовки и отмена.
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

  const apiDown = health !== null && !health.ok;
  const recording = stage === 'recording';

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
            Whisper Large v3 · {settings.model === 'turbo' ? 'Turbo' : 'Large v3'}
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
          stage={recording ? 'recording' : stage}
          level={recorder.level}
          elapsedMs={recorder.elapsedMs}
          statusText={statusText}
          onStart={() => void startRecording()}
          onStop={() => void stopAndProcess()}
          onCancel={cancelRecording}
          disabled={apiDown}
        />

        {apiDown && health && !health.ok ? (
          <div className="mt-4 max-w-[520px] rounded-2xl border border-ink-900/10 bg-white/60 px-4 py-3 text-center text-[12px] leading-relaxed text-ink-500">
            {health.message}
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
          Аудио уходит в Groq только для распознавания и не сохраняется на сервере. История и
          словарь живут в этом браузере. Всё остальное — Whisper large-v3 и LLM-чистка.
        </footer>
      </main>

      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      <audio ref={audioRef} hidden />
    </div>
  );
}

/** Короткий сигнал окончания обработки: два тихих тона через Web Audio. */
function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
