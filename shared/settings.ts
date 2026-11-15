import { DEFAULT_GROQ_SETTINGS, type GroqSettings } from './groq-client';

export type SpeacherSettings = GroqSettings & {
  /** Термины и имена собственные: идут в подсказку Whisper и в промпт чистки. */
  vocabulary: string[];
  /** Показывать плавающую пилюлю на странице во время записи. */
  showPill: boolean;
  /** Сохранять историю диктовок локально. */
  saveHistory: boolean;
};

export const DEFAULT_SETTINGS: SpeacherSettings = {
  ...DEFAULT_GROQ_SETTINGS,
  vocabulary: [],
  showPill: true,
  saveHistory: true,
};

export type HistoryEntry = {
  id: string;
  createdAt: number;
  raw: string;
  clean: string;
  style: string;
  language: string | null;
  durationMs: number;
  asrMs: number | null;
  formatMs: number | null;
  fallback: boolean;
  host: string | null;
};

export const SETTINGS_KEY = 'settings';
export const HISTORY_KEY = 'history';
export const HISTORY_LIMIT = 100;

function sanitizeSettings(raw: unknown): SpeacherSettings {
  const value = (raw ?? {}) as Partial<SpeacherSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    vocabulary: Array.isArray(value.vocabulary)
      ? value.vocabulary.filter((v): v is string => typeof v === 'string').slice(0, 60)
      : [],
    cleanup: value.cleanup ?? DEFAULT_SETTINGS.cleanup,
    saveHistory: value.saveHistory ?? DEFAULT_SETTINGS.saveHistory,
    showPill: value.showPill ?? DEFAULT_SETTINGS.showPill,
  };
}

export { sanitizeSettings };

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
