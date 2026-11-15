export type Style = 'neutral' | 'message' | 'email' | 'code';

export type LanguageChoice = 'auto' | 'ru' | 'en';

export type ModelChoice = 'turbo' | 'accurate';

export type Settings = {
  language: LanguageChoice;
  model: ModelChoice;
  style: Style;
  cleanup: boolean;
  saveHistory: boolean;
  vocabulary: string[];
};

export type Stage = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'formatting' | 'done' | 'error';

export type Timing = {
  asrMs?: number;
  formatMs?: number;
  totalMs?: number;
};

export type HistoryEntry = {
  id: string;
  createdAt: number;
  raw: string;
  clean: string;
  style: Style;
  language: string | null;
  model: string;
  durationMs: number;
  timing: Timing;
  fallback: boolean;
  pending: boolean;
  audioError?: string;
};

export type ApiError = {
  error: string;
  message: string;
  retryAfter?: number;
};

export const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  model: 'turbo',
  style: 'neutral',
  cleanup: true,
  saveHistory: true,
  vocabulary: [],
};

export const STYLE_LABELS: Record<Style, string> = {
  neutral: 'Обычный текст',
  message: 'Сообщение',
  email: 'Письмо',
  code: 'Код',
};
