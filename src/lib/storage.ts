import { DEFAULT_SETTINGS, type HistoryEntry, type Settings } from './types';

const SETTINGS_KEY = 'speacher.settings.v1';
const HISTORY_KEY = 'speacher.history.v1';
const HISTORY_LIMIT = 60;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      vocabulary: Array.isArray(parsed.vocabulary)
        ? parsed.vocabulary.filter((v): v is string => typeof v === 'string')
        : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Приватный режим браузера — молча живём без сохранения настроек.
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => typeof entry?.id === 'string');
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // localStorage может быть переполнен длинными диктовками — не роняем UI.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}
