import { Command, Loader2, Square, X } from 'lucide-react';
import type { Stage } from '../lib/types';
import { Waveform } from './Waveform';

type Props = {
  stage: Stage;
  level: number;
  elapsedMs: number;
  statusText: string;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  disabled?: boolean;
};

function formatTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/**
 * Главный объект интерфейса — тёмная пилюля, как Flow Bar у референса:
 * ни окна, ни панелей, только она и текст под ней.
 */
export function RecordingPill({
  stage,
  level,
  elapsedMs,
  statusText,
  onStart,
  onStop,
  onCancel,
  disabled = false,
}: Props) {
  const isRecording = stage === 'recording';
  const isBusy = stage === 'transcribing' || stage === 'formatting' || stage === 'requesting';

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={[
          'pill-shadow relative flex items-center gap-4 rounded-full bg-ink-900 pl-5 pr-2 py-2.5 text-cream-50',
          'transition-[width,transform] duration-300',
          isRecording ? 'min-w-[320px]' : '',
        ].join(' ')}
      >
        {isRecording ? (
          <>
            <span className="flex items-center gap-2">
              <span className="relative flex h-3.5 w-3.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-300 opacity-50" />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-rose-300" />
                <span className="absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-ink-900" />
              </span>
              <span className="w-8 tabular-nums text-[13px] font-medium text-cream-100/80">
                {formatTimer(elapsedMs)}
              </span>
            </span>
            <Waveform level={level} active />
            <button
              type="button"
              onClick={onCancel}
              className="grid h-8 w-8 place-items-center rounded-full text-cream-100/50 transition hover:bg-white/10 hover:text-cream-50"
              aria-label="Отменить запись"
              title="Отменить (Esc)"
            >
              <X size={15} />
            </button>
            <button
              type="button"
              onClick={onStop}
              className="grid h-9 w-9 place-items-center rounded-full bg-rose-300 text-ink-900 transition hover:bg-rose-200"
              aria-label="Завершить и расшифровать"
              title="Завершить (Enter)"
            >
              <Square size={13} fill="currentColor" />
            </button>
          </>
        ) : (
          <>
            {isBusy ? (
              <Loader2 size={16} className="animate-spin text-rose-200" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              onClick={onStart}
              disabled={disabled || isBusy}
              className="flex items-center gap-3 rounded-full py-1 text-left transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center gap-1.5 text-[15px] font-medium text-cream-50">
                {isBusy ? (
                  statusText
                ) : (
                  <>
                    Нажмите или зажмите
                    <kbd className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-[12px] text-rose-200">
                      {SHORTCUT}
                      <Command size={11} /> →
                    </kbd>
                    чтобы начать диктовать
                  </>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onStart}
              disabled={disabled || isBusy}
              className="grid h-10 w-10 place-items-center rounded-full bg-rose-300 text-ink-900 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Начать диктовку"
            >
              {isBusy ? <Loader2 size={15} className="animate-spin" /> : <MicDot />}
            </button>
          </>
        )}
      </div>
      <div className="h-6" aria-hidden={!isRecording && !isBusy}>
        {isRecording ? (
          <span className="rounded-full bg-ink-900 px-3 py-1.5 text-[11px] text-cream-100/60">
            Enter — готово · Esc — отмена
          </span>
        ) : null}
      </div>
      {isBusy ? (
        <span className="text-[12px] text-ink-500" role="status">
          {statusText}
        </span>
      ) : null}
    </div>
  );
}

function MicDot() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" aria-hidden="true">
      <rect x="4.5" y="0.75" width="5" height="9.5" rx="2.5" fill="currentColor" />
      <path
        d="M1.5 8.5a5.5 5.5 0 0 0 11 0M7 14v3.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
