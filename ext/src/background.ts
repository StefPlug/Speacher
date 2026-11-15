/**
 * Service worker расширения: дирижёр, а не исполнитель.
 *
 * Запись и запросы в Groq живут в offscreen-документе: service worker может
 * быть выгружен в любой момент, а MediaRecorder в нём вообще недоступен.
 * Здесь: команды, состояние, вставка текста в страницу, история.
 */
import { newId, type SpeacherSettings } from '../../shared/settings';
import { addHistory, getSettings } from './store';
import type { PipelineResult } from '../../shared/pipeline';

type State =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number; tabId: number | null }
  | { phase: 'processing'; tabId: number | null }
  | { phase: 'error'; message: string }
  | { phase: 'done'; text: string; fallback: boolean };

type PopupState = {
  phase: State['phase'];
  elapsedMs: number;
  text: string;
  fallback: boolean;
  message: string;
  hasKey: boolean;
  recording: boolean;
  notice: string | null;
};

const OFFSCREEN_PATH = 'offscreen.html';
let state: State = { phase: 'idle' };
let offscreenReady: Promise<void> | null = null;
let notice: string | null = null;

async function setState(next: State): Promise<void> {
  state = next;
  await chrome.storage.session.set({ speacherState: next }).catch(() => undefined);
}

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Запись голоса с микрофона для диктовки.',
      });
    }
  })().catch((error: unknown) => {
    offscreenReady = null;
    throw error;
  });

  return offscreenReady;
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function injectable(tab: chrome.tabs.Tab | null): tab is chrome.tabs.Tab & { id: number } {
  return Boolean(tab?.id) && Boolean(tab?.url) && /^https?:/i.test(tab!.url!);
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      return true;
    } catch {
      return false;
    }
  }
}

async function showPill(tabId: number, mode: 'listening' | 'processing' | 'done', text?: string) {
  if (!(await ensureContentScript(tabId))) return;
  await chrome.tabs.sendMessage(tabId, { type: 'pill', mode, text }).catch(() => undefined);
}

async function hidePill(tabId: number | null): Promise<void> {
  if (!tabId) return;
  await chrome.tabs.sendMessage(tabId, { type: 'pill', mode: 'hide' }).catch(() => undefined);
}

async function insertText(tabId: number, text: string): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [text],
      func: (value: string) => {
        const isEditable = (element: Element | null): element is HTMLElement => {
          if (!element) return false;
          if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
          if (element instanceof HTMLInputElement) {
            const types = ['text', 'search', 'email', 'url', 'tel', 'password'];
            return types.includes(element.type.toLowerCase()) && !element.disabled && !element.readOnly;
          }
          return element instanceof HTMLElement && element.isContentEditable;
        };

        // 1) активный элемент, 2) последнее видимое поле на странице.
        let target: HTMLElement | null = isEditable(document.activeElement)
          ? (document.activeElement as HTMLElement)
          : null;

        if (!target) {
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>(
              'textarea, input, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
            ),
          ).filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              isEditable(element) &&
              rect.width > 8 &&
              rect.height > 8 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            );
          });
          target = candidates[candidates.length - 1] ?? null;
        }

        if (!target) return { ok: false, reason: 'no-field' };
        target.focus();

        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? target.value.length;
          target.setRangeText(value, start, end, 'end');
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, reason: 'input' };
        }

        if (document.execCommand('insertText', false, value)) {
          return { ok: true, reason: 'contenteditable' };
        }

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(value);
          range.insertNode(node);
          range.setStartAfter(node);
          selection.removeAllRanges();
          selection.addRange(range);
          target.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
          return { ok: true, reason: 'range' };
        }

        return { ok: false, reason: 'no-field' };
      },
    });
    return Boolean((injection?.result as { ok?: boolean } | undefined)?.ok);
  } catch {
    return false;
  }
}

async function startDictation(): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    notice = 'Ключ Groq не задан.';
    await setState({
      phase: 'error',
      message: 'Ключ Groq не задан — откройте настройки расширения и вставьте ключ.',
    });
    void chrome.runtime.openOptionsPage();
    return;
  }

  const tab = await activeTab();
  const tabId = injectable(tab) ? tab.id : null;

  await ensureOffscreen();
  await setState({ phase: 'recording', startedAt: Date.now(), tabId });
  notice = null;

  if (tabId && settings.showPill) void showPill(tabId, 'listening');

  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    settings,
    tabId,
  });
}

async function stopDictation(): Promise<void> {
  if (state.phase !== 'recording') return;
  const tabId = state.tabId;
  await setState({ phase: 'processing', tabId });
  if (tabId) void showPill(tabId, 'processing', 'Распознаём…');
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
}

async function cancelDictation(): Promise<void> {
  const tabId = state.phase === 'recording' ? state.tabId : null;
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel' }).catch(() => undefined);
  await hidePill(tabId);
  await setState({ phase: 'idle' });
}

async function toggle(): Promise<void> {
  if (state.phase === 'recording') {
    await stopDictation();
    return;
  }
  if (state.phase === 'idle' || state.phase === 'error' || state.phase === 'done') {
    await startDictation();
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-dictation') void toggle();
});

chrome.action.onClicked.addListener(() => {
  void toggle();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as {
    type?: string;
    target?: string;
    tabId?: number;
    settings?: SpeacherSettings;
    result?: PipelineResult;
    durationMs?: number;
    message?: string;
  };

  if (msg.target === 'background') {
    void (async () => {
      if (msg.type === 'transcript' && msg.result) {
        const result = msg.result;
        const settings = await getSettings();
        const tabId = msg.tabId ?? null;
        const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
        const inserted = tabId ? await insertText(tabId, result.clean) : false;

        if (tabId) {
          void showPill(tabId, 'done', result.clean.slice(0, 120));
        } else {
          // Вставка невозможна (chrome://, Web Store) — хотя бы в буфер.
          try {
            await chrome.tabs.query({ active: true, currentWindow: true });
          } catch {
            /* ignore */
          }
        }

        await addHistory({
          id: newId(),
          createdAt: Date.now(),
          raw: result.raw,
          clean: result.clean,
          style: settings.style,
          language: result.language,
          durationMs: msg.durationMs ?? 0,
          asrMs: result.asrMs,
          formatMs: result.formatMs,
          fallback: result.fallback,
          host: tab?.url ?? null,
        });

        notice = inserted
          ? (result.notice ?? null)
          : 'Вставить в поле не удалось — текст сохранён в истории, скопируйте его оттуда.';

        await setState({ phase: 'done', text: result.clean, fallback: result.fallback });
        sendResponse({ ok: true, inserted });
        return;
      }

      if (msg.type === 'error') {
        const tabId = msg.tabId ?? null;
        notice = msg.message ?? null;
        if (tabId) void showPill(tabId, 'processing', msg.message ?? 'Ошибка');
        await setState({ phase: 'error', message: msg.message ?? 'Не удалось обработать запись.' });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'cancelled') {
        await setState({ phase: 'idle' });
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false });
    })();
    return true;
  }

  switch (msg.type) {
    case 'toggle':
      void (async () => {
        await toggle();
        sendResponse({ ok: true, phase: state.phase });
      })();
      return true;

    case 'start':
      void (async () => {
        await startDictation();
        sendResponse({ ok: true, phase: state.phase });
      })();
      return true;

    case 'stop':
      void (async () => {
        await stopDictation();
        sendResponse({ ok: true, phase: state.phase });
      })();
      return true;

    case 'cancel':
      void (async () => {
        await cancelDictation();
        sendResponse({ ok: true, phase: state.phase });
      })();
      return true;

    case 'level':
      void (async () => {
        const response = await chrome.runtime
          .sendMessage({ target: 'offscreen', type: 'level' })
          .catch(() => undefined);
        sendResponse(response ?? { level: 0 });
      })();
      return true;

    case 'get-state':
      void (async () => {
        const settings = await getSettings();
        const payload: PopupState = {
          phase: state.phase,
          elapsedMs: state.phase === 'recording' ? Date.now() - state.startedAt : 0,
          text: state.phase === 'done' ? state.text : '',
          fallback: state.phase === 'done' ? state.fallback : false,
          message: state.phase === 'error' ? state.message : '',
          hasKey: Boolean(settings.apiKey),
          recording: state.phase === 'recording',
          notice,
        };
        sendResponse(payload);
      })();
      return true;

    case 'insert-last':
      void (async () => {
        if (state.phase !== 'done') {
          sendResponse({ ok: false });
          return;
        }
        const tab = await activeTab();
        const inserted = injectable(tab) ? await insertText(tab.id, state.text) : false;
        sendResponse({ ok: inserted });
      })();
      return true;

    case 'settings-changed':
      void (async () => {
        const settings = await getSettings();
        await chrome.runtime
          .sendMessage({ target: 'offscreen', type: 'settings', settings })
          .catch(() => undefined);
        sendResponse({ ok: true });
      })();
      return true;

    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
  }
});
