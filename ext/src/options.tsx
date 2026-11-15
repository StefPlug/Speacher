import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { checkKey, GroqClientError } from '../../shared/groq-client';
import { DEFAULT_SETTINGS, type HistoryEntry, type SpeacherSettings } from '../../shared/settings';
import {
  clearHistoryStore,
  deleteHistory,
  getHistory,
  getSettings,
  setSettings,
} from './store';
import { STYLE_LABELS } from '../../shared/prompts';
import type { Style } from '../../shared/prompts';
import '../../src/index.css';

type KeyStatus =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'ok'; models: string[] }
  | { kind: 'error'; message: string };

const STYLE_KEYS = Object.keys(STYLE_LABELS) as Style[];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-ink-900/10 py-5 last:border-0">
      <h2 className="text-[14px] font-medium text-ink-900">{label}</h2>
      {hint ? <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Options() {
  const [settings, setLocal] = useState<SpeacherSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ kind: 'unknown' });
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [draftTerm, setDraftTerm] = useState('');

  const welcome = useMemo(
    () => new URLSearchParams(window.location.search).has('welcome'),
    [],
  );

  useEffect(() => {
    void (async () => {
      setLocal(await getSettings());
      setHistory(await getHistory());
      setLoaded(true);
    })();
  }, []);

  async function patch(update: Partial<SpeacherSettings>) {
    const next = await setSettings(update);
    setLocal(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
    void chrome.runtime.sendMessage({ type: 'settings-changed' }).catch(() => undefined);
  }

  async function verifyKey() {
    if (!settings.apiKey.trim()) {
      setKeyStatus({ kind: 'error', message: 'Сначала вставьте ключ.' });
      return;
    }
    setKeyStatus({ kind: 'checking' });
    try {
      const result = await checkKey(settings.apiKey.trim());
      setKeyStatus({ kind: 'ok', models: result.models });
    } catch (error) {
      setKeyStatus({
        kind: 'error',
        message: error instanceof GroqClientError ? error.message : 'Не удалось проверить ключ.',
      });
    }
  }

  function addTerm() {
    const term = draftTerm.trim();
    if (!term) return;
    if (settings.vocabulary.some((item) => item.toLowerCase() === term.toLowerCase())) {
      setDraftTerm('');
      return;
    }
    void patch({ vocabulary: [...settings.vocabulary, term].slice(0, 60) });
    setDraftTerm('');
  }

  if (!loaded) {
    return <div className="grid min-h-dvh place-items-center text-[13px] text-ink-400">Загрузка…</div>;
  }

  const asrModels = keyStatus.kind === 'ok' ? keyStatus.models : [];
  const hasAsr = (id: string) => asrModels.length === 0 || asrModels.includes(id);

  return (
    <div className="min-h-dvh bg-cream-100 text-ink-900">
      <div className="mx-auto max-w-[720px] px-5 py-10 sm:px-8">
        <header className="mb-2">
          <h1 className="display text-[34px]">Speacher</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            Настройки расширения. Всё хранится в этом браузере и никуда не отправляется, кроме
            запросов к Groq.
          </p>
        </header>

        {welcome ? (
          <div className="mt-4 rounded-3xl border border-ink-900/10 bg-white/70 p-4">
            <p className="text-[13px] leading-relaxed text-ink-900">
              Расширение установлено. Осталось два шага: вставьте ключ Groq и назначьте удобную
              комбинацию клавиш в{' '}
              <a
                className="underline decoration-ink-900/30 underline-offset-4"
                href="chrome://extensions/shortcuts"
                target="_blank"
                rel="noreferrer"
              >
                chrome://extensions/shortcuts
              </a>
              .
            </p>
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-ink-900/10 bg-white/60 px-5">
          <Field
            label="Ключ Groq"
            hint="Бесплатный ключ: console.groq.com/keys. Хранится в chrome.storage.local, виден только вам в этом браузере."
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={(event) => {
                    const apiKey = event.target.value.trim();
                    setLocal({ ...settings, apiKey });
                    setKeyStatus({ kind: 'unknown' });
                  }}
                  onBlur={(event) => void patch({ apiKey: event.target.value.trim() })}
                  placeholder="gsk_…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-full border border-ink-900/15 bg-transparent px-4 py-2.5 pr-11 font-mono text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900/40 focus:outline-none"
                  aria-label="Ключ Groq"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-400 transition hover:bg-ink-900/5 hover:text-ink-900"
                  aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void verifyKey()}
                disabled={keyStatus.kind === 'checking'}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink-900 px-4 py-2.5 text-[12px] font-medium text-cream-50 transition hover:bg-ink-700 disabled:opacity-60"
              >
                <KeyRound size={13} />
                {keyStatus.kind === 'checking' ? 'Проверяю…' : 'Проверить'}
              </button>
            </div>

            {keyStatus.kind === 'ok' ? (
              <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-500">
                <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                Ключ работает. Доступно моделей: {keyStatus.models.length}.
              </p>
            ) : null}
            {keyStatus.kind === 'error' ? (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-900">{keyStatus.message}</p>
            ) : null}

            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
              <ShieldCheck size={12} className="mt-0.5 shrink-0" />
              Аудио уходит только в Groq для распознавания. Ни наш сервер, ни аналитика его не
              видят — сервера у расширения нет вообще.
            </p>
          </Field>

          <Field
            label="Модель распознавания"
            hint="Turbo дешевле и быстрее, Large v3 точнее на сложной речи и акцентах."
          >
            <div className="inline-flex flex-wrap gap-1 rounded-full bg-ink-900/5 p-1">
              {[
                { value: 'whisper-large-v3-turbo', label: 'Turbo' },
                { value: 'whisper-large-v3', label: 'Large v3' },
              ].map((option) => {
                const active =
                  (option.value === 'whisper-large-v3-turbo' &&
                    settings.asrModel === 'whisper-large-v3-turbo') ||
                  (option.value === 'whisper-large-v3' &&
                    settings.asrModelAccurate === 'whisper-large-v3');
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      void patch(
                        option.value === 'whisper-large-v3-turbo'
                          ? { asrModel: option.value, asrModelAccurate: 'whisper-large-v3' }
                          : { asrModel: 'whisper-large-v3-turbo', asrModelAccurate: option.value },
                      )
                    }
                    className={[
                      'rounded-full px-3 py-1.5 text-[12px] transition',
                      active ? 'bg-ink-900 text-cream-50' : 'text-ink-500 hover:text-ink-900',
                    ].join(' ')}
                    title={hasAsr(option.value) ? undefined : 'Модель не видна в вашем ключе'}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Язык" hint="Авто — Whisper определит сам. Явный язык точнее и быстрее.">
            <div className="inline-flex flex-wrap gap-1 rounded-full bg-ink-900/5 p-1">
              {[
                { value: 'auto', label: 'Авто' },
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void patch({ language: option.value as SpeacherSettings['language'] })}
                  className={[
                    'rounded-full px-3 py-1.5 text-[12px] transition',
                    settings.language === option.value
                      ? 'bg-ink-900 text-cream-50'
                      : 'text-ink-500 hover:text-ink-900',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Стиль текста" hint="На что похож результат: заметка, сообщение, письмо, комментарий к коду.">
            <div className="flex flex-wrap gap-1.5">
              {STYLE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void patch({ style: key })}
                  className={[
                    'rounded-full px-3 py-1.5 text-[12px] transition',
                    settings.style === key
                      ? 'bg-ink-900 text-cream-50'
                      : 'bg-ink-900/5 text-ink-500 hover:text-ink-900',
                  ].join(' ')}
                >
                  {STYLE_LABELS[key]}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="Чистка текста"
            hint="Убирает «э-э» и оговорки, ставит пунктуацию. Выключите для дословной расшифровки."
          >
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span className="text-[13px] text-ink-900">Применять LLM-чистку</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.cleanup}
                onClick={() => void patch({ cleanup: !settings.cleanup })}
                className={[
                  'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition',
                  settings.cleanup ? 'bg-ink-900' : 'bg-ink-900/15',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-5 w-5 rounded-full bg-cream-50 transition-transform',
                    settings.cleanup ? 'translate-x-[22px]' : 'translate-x-0.5',
                  ].join(' ')}
                />
              </button>
            </label>
          </Field>

          <Field
            label="Личный словарь"
            hint="Имена, бренды, термины. Идут в подсказку Whisper и в чистку текста. До 60 штук."
          >
            <div className="flex gap-2">
              <input
                value={draftTerm}
                onChange={(event) => setDraftTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTerm();
                  }
                }}
                placeholder="Например: Kubernetes"
                className="min-w-0 flex-1 rounded-full border border-ink-900/15 bg-transparent px-4 py-2 text-[13px] placeholder:text-ink-400 focus:border-ink-900/40 focus:outline-none"
                aria-label="Новый термин"
              />
              <button
                type="button"
                onClick={addTerm}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900 text-cream-50 transition hover:bg-ink-700"
                aria-label="Добавить термин"
              >
                <Plus size={15} />
              </button>
            </div>
            {settings.vocabulary.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {settings.vocabulary.map((term) => (
                  <li
                    key={term}
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/5 px-2.5 py-1 text-[12px]"
                  >
                    {term}
                    <button
                      type="button"
                      onClick={() =>
                        void patch({ vocabulary: settings.vocabulary.filter((item) => item !== term) })
                      }
                      className="text-ink-400 transition hover:text-ink-900"
                      aria-label={`Удалить ${term}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-ink-400">Словарь пока пуст.</p>
            )}
          </Field>

          <Field
            label="Поведение"
            hint="Пилюля — маленький индикатор записи внизу страницы. История хранится только локально."
          >
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start justify-between gap-4">
                <span className="text-[13px]">Показывать пилюлю на странице</span>
                <input
                  type="checkbox"
                  checked={settings.showPill}
                  onChange={(event) => void patch({ showPill: event.target.checked })}
                  className="mt-1 h-4 w-4 accent-ink-900"
                />
              </label>
              <label className="flex cursor-pointer items-start justify-between gap-4">
                <span className="text-[13px]">Сохранять историю диктовок</span>
                <input
                  type="checkbox"
                  checked={settings.saveHistory}
                  onChange={(event) => void patch({ saveHistory: event.target.checked })}
                  className="mt-1 h-4 w-4 accent-ink-900"
                />
              </label>
            </div>
          </Field>

          <Field
            label={`История (${history.length})`}
            hint="Только в этом браузере. Аудио не сохраняется никогда — только текст."
          >
            {history.length === 0 ? (
              <p className="text-[12px] text-ink-400">Пока пусто.</p>
            ) : (
              <>
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {history.slice(0, 20).map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-2xl border border-ink-900/8 bg-white/60 p-3 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] text-ink-400">
                        <span>
                          {new Date(entry.createdAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void (async () => {
                              await deleteHistory(entry.id);
                              setHistory(await getHistory());
                            })()
                          }
                          className="text-ink-400 transition hover:text-ink-900"
                          aria-label="Удалить запись"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-3 leading-relaxed text-ink-900">{entry.clean}</p>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      await clearHistoryStore();
                      setHistory([]);
                    })()
                  }
                  className="mt-3 text-[12px] text-ink-400 underline decoration-ink-900/15 underline-offset-4 transition hover:text-ink-900"
                >
                  Очистить историю
                </button>
              </>
            )}
          </Field>
        </div>

        <footer className="mt-6 flex items-center justify-between text-[11px] text-ink-400">
          <span>{saved ? 'Сохранено' : 'Изменения сохраняются сразу'}</span>
          <span>Права: активная вкладка, микрофон, хранилище</span>
        </footer>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<Options />);
}
