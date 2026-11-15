import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../shared/pipeline';
import { GroqClientError, checkKey } from '../shared/groq-client';
import type { GroqSettings } from '../shared/groq-client';

const settings: GroqSettings = {
  apiKey: 'gsk_test',
  asrModel: 'whisper-large-v3-turbo',
  asrModelAccurate: 'whisper-large-v3',
  llmModel: 'openai/gpt-oss-20b',
  language: 'ru',
  style: 'message',
  cleanup: true,
};

type FetchCall = { url: string; init: RequestInit };

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const asrResponse = (text: string, noSpeech = 0.01) =>
  json({ text, language: 'ru', duration: 6.2, segments: [{ no_speech_prob: noSpeech }] });

const chatResponse = (content: string) => json({ choices: [{ message: { content } }] });

const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runPipeline', () => {
  it('возвращает вычищенный текст и замеры, когда обе стадии прошли', async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('/audio/transcriptions')) {
        return asrResponse('э-э, ну давай в четверг');
      }
      return chatResponse('Давай в четверг.');
    });

    const result = await runPipeline({ blob, settings, vocabulary: ['Kubernetes'], modelChoice: 'turbo' });

    expect(result.clean).toBe('Давай в четверг.');
    expect(result.raw).toBe('э-э, ну давай в четверг');
    expect(result.fallback).toBe(false);
    expect(result.language).toBe('ru');
    expect(result.formatMs).not.toBeNull();
    expect(calls).toHaveLength(2);

    // Ключ и модель уходят правильными заголовками и полями.
    const asr = calls[0];
    expect((asr.init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test');
    const form = asr.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(String(form.get('prompt'))).toContain('Kubernetes');
    expect(form.get('language')).toBe('ru');
  });

  it('выбирает Large v3 для режима accurate', async () => {
    const calls = mockFetch((call) =>
      call.url.includes('/audio/transcriptions') ? asrResponse('текст') : chatResponse('Текст.'),
    );

    await runPipeline({ blob, settings, vocabulary: [], modelChoice: 'accurate' });

    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
  });

  it('не чистит, когда cleanup выключен, и не ходит в LLM', async () => {
    const calls = mockFetch(() => asrResponse('сырой текст'));

    const result = await runPipeline({
      blob,
      settings: { ...settings, cleanup: false },
      vocabulary: [],
      modelChoice: 'turbo',
    });

    expect(result.clean).toBe('сырой текст');
    expect(result.formatMs).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('отбрасывает тишину по no_speech_prob', async () => {
    mockFetch(() => asrResponse('Спасибо за просмотр!', 0.92));

    await expect(
      runPipeline({ blob, settings, vocabulary: [], modelChoice: 'turbo' }),
    ).rejects.toMatchObject({ code: 'no_speech' });
  });

  it('отбрасывает пустой ответ ASR', async () => {
    mockFetch(() => asrResponse(''));

    await expect(
      runPipeline({ blob, settings, vocabulary: [], modelChoice: 'turbo' }),
    ).rejects.toBeInstanceOf(GroqClientError);
  });

  it('откатывается к дословному тексту, если LLM вернул ерунду', async () => {
    mockFetch((call) =>
      call.url.includes('/audio/transcriptions')
        ? asrResponse('короткая фраза')
        : chatResponse('Очень длинный ответ, который модель придумала сама и которого не было в речи. '.repeat(20)),
    );

    const result = await runPipeline({ blob, settings, vocabulary: [], modelChoice: 'turbo' });

    expect(result.fallback).toBe(true);
    expect(result.clean).toBe('короткая фраза');
    expect(result.notice).toContain('дословный');
  });

  it('не ломает диктовку при падении LLM', async () => {
    mockFetch((call) =>
      call.url.includes('/audio/transcriptions')
        ? asrResponse('важная мысль')
        : new Response('boom', { status: 500 }),
    );

    const result = await runPipeline({ blob, settings, vocabulary: [], modelChoice: 'turbo' });

    expect(result.clean).toBe('важная мысль');
    expect(result.fallback).toBe(true);
    expect(result.notice).toContain('Чистка недоступна');
  });

  it('пробрасывает 429 с retryAfter', async () => {
    mockFetch(
      () =>
        new Response('{"error":"rate limit"}', {
          status: 429,
          headers: { 'retry-after': '7' },
        }),
    );

    await expect(
      runPipeline({ blob, settings, vocabulary: [], modelChoice: 'turbo' }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryAfter: 7 });
  });

  it('сообщает про отсутствующий ключ до сетевого запроса', async () => {
    const calls = mockFetch(() => json({}));

    await expect(
      runPipeline({
        blob,
        settings: { ...settings, apiKey: '' },
        vocabulary: [],
        modelChoice: 'turbo',
      }),
    ).rejects.toMatchObject({ code: 'no_key' });
    expect(calls).toHaveLength(0);
  });
});

describe('checkKey', () => {
  it('возвращает список моделей', async () => {
    mockFetch(() => json({ data: [{ id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-20b' }] }));

    const result = await checkKey('gsk_test');

    expect(result.models).toEqual(['whisper-large-v3', 'openai/gpt-oss-20b']);
  });

  it('распознаёт неверный ключ', async () => {
    mockFetch(() => new Response('unauthorized', { status: 401 }));

    await expect(checkKey('bad')).rejects.toMatchObject({ code: 'bad_key' });
  });

  it('отдаёт сетевую ошибку отдельно от ошибок ключа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(checkKey('gsk_test')).rejects.toMatchObject({ code: 'network' });
  });
});
