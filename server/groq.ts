/**
 * Тонкий клиент Groq API. Без SDK: два эндпоинта, глобальный fetch.
 *
 * Важно: аудио нигде не сохраняется на нашем сервере — буфер уходит
 * в Groq одним запросом и забывается.
 */

// GROQ_BASE_URL позволяет направить запросы на совместимый прокси или мок
// (используется в тестах и при self-host за корпоративным шлюзом).
const GROQ_BASE = (process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');

export type Limits = {
  requestsPerDay?: number;
  remainingRequests?: number;
  resetRequests?: string;
} | null;

export class GroqError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  details?: string;

  constructor(opts: {
    message: string;
    status: number;
    code: string;
    retryAfter?: number;
    details?: string;
  }) {
    super(opts.message);
    this.name = 'GroqError';
    this.status = opts.status;
    this.code = opts.code;
    this.retryAfter = opts.retryAfter;
    this.details = opts.details;
  }
}

let lastLimits: Limits = null;

export function getLastLimits(): Limits {
  return lastLimits;
}

type LoggedError = { status: number; code: string; message: string; retryAfter?: number };

/**
 * Один запрос к Groq с разбором ошибок в терминах продукта.
 * Ретраи делает вызывающий код — там больше контекста.
 */
async function groqFetch(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${GROQ_BASE}${path}`, init);
  } catch (error) {
    throw new GroqError({
      message: 'Не удалось связаться с Groq. Проверьте интернет на сервере.',
      status: 502,
      code: 'network',
      details: error instanceof Error ? error.message : String(error),
    });
  }

  lastLimits = {
    requestsPerDay: Number(response.headers.get('x-ratelimit-limit-requests') ?? 0) || undefined,
    remainingRequests:
      Number(response.headers.get('x-ratelimit-remaining-requests') ?? 0) || undefined,
    resetRequests: response.headers.get('x-ratelimit-reset-requests') ?? undefined,
  };

  if (response.ok) return response;

  const bodyText = await response.text();
  const retryAfterRaw = response.headers.get('retry-after');
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) || undefined : undefined;

  const describe = (): LoggedError => {
    if (response.status === 401 || response.status === 403) {
      return {
        status: 401,
        code: 'bad_key',
        message: 'Groq отклонил ключ API. Проверьте GROQ_API_KEY.',
      };
    }
    if (response.status === 429) {
      return {
        status: 429,
        code: 'rate_limit',
        message: retryAfter
          ? `Достигнут лимит Groq. Повторите через ${retryAfter} с.`
          : 'Достигнут лимит Groq. Повторите чуть позже.',
        retryAfter,
      };
    }
    if (response.status === 413) {
      return {
        status: 413,
        code: 'too_large',
        message: 'Аудиофайл слишком большой для Groq (лимит 25 МБ).',
      };
    }
    if (response.status >= 500) {
      return {
        status: 503,
        code: 'upstream',
        message: 'Groq временно недоступен. Попробуйте ещё раз.',
        retryAfter,
      };
    }
    return {
      status: 400,
      code: 'bad_request',
      message: 'Groq не принял запрос.',
    };
  };

  const described = describe();
  throw new GroqError({ ...described, details: bodyText.slice(0, 500) });
}

export type TranscriptionResult = {
  text: string;
  language?: string;
  duration?: number;
  noSpeechProbability?: number;
  avgLogprob?: number;
};

export async function transcribe(opts: {
  apiKey: string;
  audio: Buffer;
  filename: string;
  mimeType: string;
  model: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<TranscriptionResult> {
  const form = new FormData();
  const bytes = new Uint8Array(opts.audio);
  form.append('file', new Blob([bytes], { type: opts.mimeType }), opts.filename);
  form.append('model', opts.model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', String(opts.temperature ?? 0));
  if (opts.language && opts.language !== 'auto') form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);

  const response = await groqFetch('/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: opts.signal,
  });

  const data = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ no_speech_prob?: number; avg_logprob?: number }>;
    words?: unknown[];
  };

  const segments = data.segments ?? [];
  const noSpeechProbability =
    segments.length > 0
      ? Math.max(...segments.map((s) => s.no_speech_prob ?? 0))
      : undefined;
  const avgLogprob =
    segments.length > 0
      ? segments.reduce((sum, s) => sum + (s.avg_logprob ?? 0), 0) / segments.length
      : undefined;

  return {
    text: (data.text ?? '').trim(),
    language: data.language,
    duration: data.duration,
    noSpeechProbability,
    avgLogprob,
  };
}

export async function complete(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await groqFetch(
    '/chat/completions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 2048,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
      signal: opts.signal,
    },
  );

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

export async function listModels(apiKey: string): Promise<string[]> {
  const response = await groqFetch('/models', {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const data = (await response.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id);
}
