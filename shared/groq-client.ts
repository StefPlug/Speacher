/**
 * Браузерный клиент Groq API для расширения (BYOK).
 *
 * Ключ приходит из chrome.storage.local и живёт только в памяти воркера
 * на время запроса. Прямые запросы из браузера разрешены, потому что
 * расширение имеет host_permissions на api.groq.com — CORS не применяется.
 */

const GROQ_BASE = 'https://api.groq.com/openai/v1';

export type GroqSettings = {
  apiKey: string;
  asrModel: string;
  asrModelAccurate: string;
  llmModel: string;
  language: 'auto' | 'ru' | 'en';
  style: import('./prompts').Style;
  cleanup: boolean;
};

export const DEFAULT_GROQ_SETTINGS: GroqSettings = {
  apiKey: '',
  asrModel: 'whisper-large-v3-turbo',
  asrModelAccurate: 'whisper-large-v3',
  llmModel: 'openai/gpt-oss-20b',
  language: 'auto',
  style: 'neutral',
  cleanup: true,
};

export type GroqErrorCode =
  | 'no_key'
  | 'bad_key'
  | 'rate_limit'
  | 'too_large'
  | 'upstream'
  | 'network'
  | 'bad_request'
  | 'no_speech';

export class GroqClientError extends Error {
  code: GroqErrorCode;
  retryAfter?: number;
  details?: string;

  constructor(opts: { message: string; code: GroqErrorCode; retryAfter?: number; details?: string }) {
    super(opts.message);
    this.name = 'GroqClientError';
    this.code = opts.code;
    this.retryAfter = opts.retryAfter;
    this.details = opts.details;
  }
}

async function request(path: string, apiKey: string, init: RequestInit): Promise<Response> {
  if (!apiKey) {
    throw new GroqClientError({
      code: 'no_key',
      message: 'Ключ Groq не задан. Откройте настройки расширения и вставьте ключ.',
    });
  }

  let response: Response;
  try {
    response = await fetch(`${GROQ_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    throw new GroqClientError({
      code: 'network',
      message: 'Нет связи с Groq. Проверьте интернет.',
      details: error instanceof Error ? error.message : String(error),
    });
  }

  if (response.ok) return response;

  const body = await response.text().catch(() => '');
  const retryAfterRaw = response.headers.get('retry-after');
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) || undefined : undefined;

  if (response.status === 401 || response.status === 403) {
    throw new GroqClientError({
      code: 'bad_key',
      message: 'Groq отклонил ключ. Проверьте его в настройках — возможно, он удалён.',
      details: body.slice(0, 300),
    });
  }
  if (response.status === 429) {
    throw new GroqClientError({
      code: 'rate_limit',
      message: retryAfter
        ? `Достигнут лимит Groq. Повторите через ${retryAfter} с.`
        : 'Достигнут лимит Groq. Повторите чуть позже.',
      retryAfter,
    });
  }
  if (response.status === 413) {
    throw new GroqClientError({
      code: 'too_large',
      message: 'Аудио слишком большое для Groq (лимит 25 МБ). Запись короче 5 минут.',
    });
  }
  if (response.status >= 500) {
    throw new GroqClientError({
      code: 'upstream',
      message: 'Groq временно недоступен. Попробуйте ещё раз.',
      retryAfter,
      details: body.slice(0, 300),
    });
  }
  throw new GroqClientError({
    code: 'bad_request',
    message: 'Groq не принял запрос.',
    details: body.slice(0, 300),
  });
}

export async function checkKey(apiKey: string): Promise<{ ok: true; models: string[] }> {
  const response = await request('/models', apiKey, { method: 'GET' });
  const data = (await response.json()) as { data?: Array<{ id: string }> };
  return { ok: true, models: (data.data ?? []).map((m) => m.id) };
}

export type TranscriptionResult = {
  text: string;
  language: string | null;
  audioSeconds: number | null;
  noSpeechProbability: number | null;
};

export async function transcribeWithGroq(opts: {
  apiKey: string;
  blob: Blob;
  model: string;
  language: 'auto' | 'ru' | 'en';
  prompt: string;
}): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('file', opts.blob, opts.blob.type.includes('mp4') ? 'dictation.mp4' : 'dictation.webm');
  form.append('model', opts.model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (opts.language !== 'auto') form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);

  const response = await request('/audio/transcriptions', opts.apiKey, {
    method: 'POST',
    body: form,
  });

  const data = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ no_speech_prob?: number }>;
  };

  const segments = data.segments ?? [];
  return {
    text: (data.text ?? '').trim(),
    language: data.language ?? null,
    audioSeconds: data.duration ?? null,
    noSpeechProbability:
      segments.length > 0 ? Math.max(...segments.map((s) => s.no_speech_prob ?? 0)) : null,
  };
}

export async function formatWithGroq(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const response = await request('/chat/completions', opts.apiKey, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.2,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  });

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
