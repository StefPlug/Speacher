import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { LanguageChoice, ModelChoice, Settings, Style } from '../lib/types';
import { STYLE_LABELS } from '../lib/types';

type Props = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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
  options: Array<{ value: T; label: string; hint?: string }>;
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
          title={option.hint}
          className={[
            'rounded-full px-3 py-1.5 text-[12px] transition',
            value === option.value
              ? 'bg-ink-900 text-cream-50'
              : 'text-ink-500 hover:text-ink-900',
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
        {hint ? <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">{hint}</span> : null}
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

  function addTerm() {
    const term = draft.trim();
    if (!term) return;
    if (settings.vocabulary.some((item) => item.toLowerCase() === term.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange({ vocabulary: [...settings.vocabulary, term].slice(0, 40) });
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
            title="Модель распознавания"
            hint="Turbo дешевле и быстрее, Large v3 точнее на сложной речи."
          >
            <Segmented<ModelChoice>
              value={settings.model}
              onChange={(model) => onChange({ model })}
              options={[
                { value: 'turbo', label: 'Turbo' },
                { value: 'accurate', label: 'Large v3' },
              ]}
            />
          </Section>

          <Section title="Язык" hint="Авто — Whisper определит сам. Явный язык точнее и быстрее.">
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
            hint="Убирает «э-э» и оговорки, ставит пунктуацию и абзацы. Выключите, если нужен дословный текст."
          >
            <Toggle
              checked={settings.cleanup}
              onChange={(cleanup) => onChange({ cleanup })}
              label="Применять LLM-чистку"
            />
          </Section>

          <Section
            title="Личный словарь"
            hint="Имена, бренды, термины. Попадают в подсказку Whisper и в чистку текста. До 40 штук."
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

          <Section
            title="История"
            hint="Хранится только в этом браузере, в localStorage. Аудио не сохраняется никогда."
          >
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
