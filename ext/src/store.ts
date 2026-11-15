/**
 * Хранилище расширения поверх chrome.storage.local.
 * Всё хранится на устройстве пользователя: ключ, настройки, история.
 */
import {
  DEFAULT_SETTINGS,
  HISTORY_KEY,
  HISTORY_LIMIT,
  SETTINGS_KEY,
  sanitizeSettings,
  type HistoryEntry,
  type SpeacherSettings,
} from '../../shared/settings';

export async function getSettings(): Promise<SpeacherSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

export async function setSettings(patch: Partial<SpeacherSettings>): Promise<SpeacherSettings> {
  const current = await getSettings();
  const next = sanitizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const list = stored[HISTORY_KEY];
  if (!Array.isArray(list)) return [];
  return (list as HistoryEntry[]).filter((entry) => typeof entry?.id === 'string');
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const settings = await getSettings();
  if (!settings.saveHistory) return;
  const list = await getHistory();
  await chrome.storage.local.set({ [HISTORY_KEY]: [entry, ...list].slice(0, HISTORY_LIMIT) });
}

export async function deleteHistory(id: string): Promise<void> {
  const list = await getHistory();
  await chrome.storage.local.set({ [HISTORY_KEY]: list.filter((entry) => entry.id !== id) });
}

export async function clearHistoryStore(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}
