/**
 * Offscreen-документ: живёт отдельно от попапа и service worker'а,
 * поэтому запись не обрывается, когда пользователь закрывает попап.
 * Здесь же выполняются запросы в Groq — они переживают выгрузку воркера.
 */
import { runPipeline } from '../../shared/pipeline';
import type { SpeacherSettings } from '../../shared/settings';
import { GroqClientError } from '../../shared/groq-client';
import { startCapture, stopCapture, cancelCapture } from './capture';

let settings: SpeacherSettings | null = null;
let tabId: number | null = null;
let startedAt = 0;
let lastLevel = 0;

function send(message: unknown): void {
  void chrome.runtime.sendMessage({ target: 'background', ...(message as object) });
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as {
    type?: string;
    settings?: SpeacherSettings;
    tabId?: number;
  };

  if (msg.type === 'settings' && msg.settings) {
    settings = msg.settings;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'start') {
    void (async () => {
      if (!msg.settings) {
        sendResponse({ ok: false, error: 'нет настроек' });
        return;
      }
      settings = msg.settings;
      try {
        tabId = msg.tabId ?? null;
        await startCapture((level) => {
          lastLevel = level;
          // Уровень громкости нужен только пилюле; шлём не чаще 10 раз в секунду.
          if (tabId) void chrome.tabs.sendMessage(tabId, { type: 'pill-level', level }).catch(() => undefined);
        });
        startedAt = performance.now();
        sendResponse({ ok: true });
      } catch (error) {
        const messageText =
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Доступ к микрофону запрещён. Разрешите его в настройках расширения.'
            : error instanceof Error
              ? error.message
              : 'Не удалось открыть микрофон.';
        send({ type: 'error', message: messageText, tabId });
        sendResponse({ ok: false, error: messageText });
      }
    })();
    return true;
  }

  if (msg.type === 'stop') {
    void (async () => {
      if (!settings) {
        sendResponse({ ok: false, error: 'нет настроек' });
        return;
      }
      try {
        const recording = await stopCapture();
        const durationMs = Math.round(performance.now() - startedAt);

        const result = await runPipeline({
          blob: recording.blob,
          settings,
          vocabulary: settings.vocabulary,
          modelChoice: 'turbo',
          host: null,
        });

        send({ type: 'transcript', result, tabId, durationMs });
        sendResponse({ ok: true });
      } catch (error) {
        const messageText =
          error instanceof GroqClientError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Не удалось обработать запись.';
        send({ type: 'error', message: messageText, tabId });
        sendResponse({ ok: false, error: messageText });
      } finally {
        tabId = null;
      }
    })();
    return true;
  }

  if (msg.type === 'level') {
    sendResponse({ level: lastLevel });
    return false;
  }

  if (msg.type === 'cancel') {
    cancelCapture();
    send({ type: 'cancelled', tabId });
    tabId = null;
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Страховка: если offscreen закрывают, отпускаем микрофон.
window.addEventListener('pagehide', () => cancelCapture());
