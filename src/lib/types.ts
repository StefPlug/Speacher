/** Веб-версия использует те же типы настроек, что и расширение. */
export type {
  SpeacherSettings,
  HistoryEntry,
} from '../../shared/settings';
export { DEFAULT_SETTINGS } from '../../shared/settings';
export { STYLE_LABELS } from '../../shared/prompts';
export type { Style } from '../../shared/prompts';

export type LanguageChoice = 'auto' | 'ru' | 'en';
export type ModelChoice = 'turbo' | 'accurate';

export type Stage =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'transcribing'
  | 'formatting'
  | 'done'
  | 'error';

export type Timing = {
  asrMs?: number;
  formatMs?: number;
  totalMs?: number;
};

export type ApiError = {
  error: string;
  message: string;
  retryAfter?: number;
};
