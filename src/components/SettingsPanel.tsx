import { Eye, EyeOff, KeyRound, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { checkKey, GroqClientError } from '../lib/api';
import type { LanguageChoice, ModelChoice, SpeacherSettings, Style } from '../lib/types';
import { STYLE_LABELS } from '../lib/types';

type Props = {
  settings: SpeacherSettings;
  onChange: (patch: Partial<SpeacherSettings>) => void;
  onClose: () => void;
};

type KeyStatus =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'ok'; count: number }
  | { kind: 'error'; message: string };

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-ink-900/10 py-5 last:border-0">
      <h3 className="text-[14px] font-medium text-ink-900">{title}</h3>
      {hint ? <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-ink-900/5 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={[
            'rounded-full px-3 py-1.5 text-[12px] transition',
            value === option.value ? 'bg-ink-900 text-cream-50' : 'text-ink-500 hover:text-ink-900',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-[13px] text-ink-900">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">{hint}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-ink-900' : 'bg-ink-900/15',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-cream-50 transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  );
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [draft, setDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ kind: 'unknown' });

  async function verify() {
    if (!settings.apiKey.trim()) {
      setKeyStatus({ kind: 'error', message: 'Сначала вставьте ключ.' });
      return;
    }
    setKeyStatus({ kind: 'checking' });
    try {
      const result = await checkKey(settings.apiKey.trim());
      setKeyStatus({ kind: 'ok', count: result.models.length });
    } catch (error) {
      setKeyStatus({
        kind: 'error',
        message: error instanceof GroqClientError ? error.message : 'Не удалось проверить ключ.',
      });
    }
  }

  function addTerm() {
    const term = draft.trim();
    if (!term) return;
    if (settings.vocabulary.some((item) => item.toLowerCase() === term.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange({ vocabulary: [...settings.vocabulary, term].slice(0, 60) });
    setDraft('');
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/25 backdrop-blur-[2px]">
      <div
        className="h-full w-full max-w-[460px] overflow-y-auto bg-cream-50 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="display text-[26px] text-ink-900">Настройки</h2>
            <p className="mt-1 text-[12px] text-ink-500">Всё хранится в этом браузере.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-ink-900/5 text-ink-500 transition hover:bg-ink-900/10 hover:text-ink-900"
            aria-label="Закрыть настройки"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4">
          <Section
            title="Ключ Groq"
            hint="Бесплатный ключ: console.groq.com/keys. Хранится в этом браузере и уходит только в Groq."
          >
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={(event) => {
                    onChange({ apiKey: event.target.value.trim() });
                    setKeyStatus({ kind: 'unknown' });
                  }}
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
                onClick={() => void verify()}
                disabled={keyStatus.kind === 'checking'}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink-900 px-4 py-2.5 text-[12px] font-medium text-cream-50 transition hover:bg-ink-700 disabled:opacity-60"
              >
                <KeyRound size={13} />
                {keyStatus.kind === 'checking' ? '…' : 'Проверить'}
              </button>
            </div>

            {keyStatus.kind === 'ok' ? (
              <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-500">
                <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                Ключ работает, доступно моделей: {keyStatus.count}.
              </p>
            ) : null}
            {keyStatus.kind === 'error' ? (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-900">{keyStatus.message}</p>
            ) : null}

            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
              <ShieldCheck size={12} className="mt-0.5 shrink-0" />
              Это статическая страница без сервера: аудио идёт из браузера прямо в Groq. Ключ
              виден тому, у кого есть доступ к этому браузеру, — не используйте его на чужой машине.
            </p>
          </Section>

          <Section
            title="Модель распознавания"
            hint="Turbo дешевле и быстрее, Large v3 точнее на сложной речи."
          >
            <Segmented<ModelChoice>
              value={settings.asrModel === 'whisper-large-v3' ? 'accurate' : 'turbo'}
              onChange={(model) =>
                onChange(
                  model === 'accurate'
                    ? { asrModelAccurate: 'whisper-large-v3' }
                    : { asrModel: 'whisper-large-v3-turbo' },
                )
              }
              options={[
                { value: 'turbo', label: 'Turbo' },
                { value: 'accurate', label: 'Large v3' },
              ]}
            />
          </Section>

          <Section title="Язык" hint="Авто — Whisper определит сам. Явный язык точнее.">
            <Segmented<LanguageChoice>
              value={settings.language}
              onChange={(language) => onChange({ language })}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Section>

          <Section title="Стиль по умолчанию">
            <Segmented<Style>
              value={settings.style}
              onChange={(style) => onChange({ style })}
              options={(Object.keys(STYLE_LABELS) as Style[]).map((key) => ({
                value: key,
                label: STYLE_LABELS[key],
              }))}
            />
          </Section>

          <Section
            title="Чистка текста"
            hint="Убирает «э-э» и оговорки, ставит пунктуацию и абзацы."
          >
            <Toggle
              checked={settings.cleanup}
              onChange={(cleanup) => onChange({ cleanup })}
              label="Применять LLM-чистку"
            />
          </Section>

          <Section
            title="Личный словарь"
            hint="Имена, бренды, термины. Идут в подсказку Whisper и в чистку. До 60 штук."
          >
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTerm();
                  }
                }}
                placeholder="Например: Kubernetes"
                className="min-w-0 flex-1 rounded-full border border-ink-900/15 bg-transparent px-3.5 py-2 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900/40 focus:outline-none"
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
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/5 px-2.5 py-1 text-[12px] text-ink-900"
                  >
                    {term}
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ vocabulary: settings.vocabulary.filter((item) => item !== term) })
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
          </Section>

          <Section title="История" hint="Хранится только в этом браузере. Аудио не сохраняется никогда.">
            <Toggle
              checked={settings.saveHistory}
              onChange={(saveHistory) => onChange({ saveHistory })}
              label="Сохранять историю диктовок"
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
