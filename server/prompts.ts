/**
 * Промпты для двух стадий.
 *
 * Стадия 1 (ASR): `prompt` у Whisper — до 224 токенов, задаёт стиль и написание
 * имён собственных. Кладём туда личный словарь, а не инструкции.
 *
 * Стадия 2 (LLM): чистка расшифровки. Главное правило — не добавлять смысла.
 */

export type Style = 'neutral' | 'message' | 'email' | 'code';

export const STYLES: Style[] = ['neutral', 'message', 'email', 'code'];

const STYLE_RULES: Record<Style, string> = {
  neutral: 'Нейтральный письменный стиль: обычные абзацы, без приветствий и подписей.',
  message:
    'Короткое сообщение в чат: без приветствия, без подписи, без канцелярита. Одна-три фразы, если этого достаточно.',
  email:
    'Письмо: вежливо и по делу, абзацы. НЕ придумывай приветствие и подпись, если их не было в речи.',
  code: 'Комментарий к коду или техническая заметка: короткие строки, без эмодзи, без вежливых оборотов, термины латиницей как принято в коде.',
};

/** Обрезает строку по границе токена-слова, чтобы уложиться в лимит Whisper. */
export function truncatePrompt(text: string, maxChars = 700): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Подсказка для ASR. Whisper использует её как образец стиля и орфографии,
 * поэтому пишем связной фразой, а не списком.
 */
export function buildAsrPrompt(opts: {
  vocabulary: string[];
  appHint?: string;
  language?: string;
}): string {
  const parts: string[] = [];
  if (opts.vocabulary.length > 0) {
    parts.push(`Термины и имена, которые нужно писать именно так: ${opts.vocabulary.join(', ')}.`);
  }
  if (opts.appHint) {
    parts.push(`Текст диктуется в приложении: ${opts.appHint}.`);
  }
  if (opts.language === 'ru') {
    parts.push('Речь на русском языке, с обычной пунктуацией.');
  } else if (opts.language === 'en') {
    parts.push('Speech is in English, with normal punctuation.');
  }
  return truncatePrompt(parts.join(' '));
}

export function buildFormatSystemPrompt(opts: {
  style: Style;
  vocabulary: string[];
  language?: string;
}): string {
  const langRule =
    opts.language === 'ru'
      ? 'Ответ на русском языке.'
      : opts.language === 'en'
        ? 'Answer in English.'
        : 'Отвечай на том же языке, на котором была речь.';

  const vocabRule =
    opts.vocabulary.length > 0
      ? `Эти термины пиши ровно так: ${opts.vocabulary.join(', ')}.`
      : '';

  return [
    'Ты — редактор расшифровки голосовой диктовки. Твоя задача — превратить устную речь в готовый письменный текст.',
    '',
    'Что делать:',
    '1. Убрать слова-заполнители и запинки: «э-э», «ну», «как бы», «типа», «вот», «это самое», um, uh, like, you know.',
    '2. Восстановить самокоррекции: если говорящий поправил себя («во вторник, то есть в четверг»), оставить только исправленный вариант.',
    '3. Расставить пунктуацию, заглавные буквы, разбить на абзацы по смыслу.',
    '4. Убрать повторы слов и ложные начала, если они возникли из-за устной речи.',
    '',
    'Чего делать нельзя:',
    '- Добавлять факты, имена, числа, ссылки, приветствия и подписи, которых не было в речи.',
    '- Сокращать или пересказывать: смысл и порядок мыслей должны сохраниться полностью.',
    '- Отвечать на реплики, задавать вопросы, комментировать задачу. Ты не собеседник.',
    '- Добавлять пояснения, заголовки вроде «Вот исправленный текст» или markdown-обёртки, если об этом не просили.',
    '',
    `Стиль: ${STYLE_RULES[opts.style]}`,
    langRule,
    vocabRule,
    '',
    'Верни только итоговый текст, без кавычек вокруг него.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export const FORMAT_USER_PREFIX = 'Расшифровка диктовки:\n';
