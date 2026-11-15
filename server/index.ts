import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {
  GroqError,
  complete,
  getLastLimits,
  listModels,
  transcribe,
  type TranscriptionResult,
} from './groq.ts';
import {
  FORMAT_USER_PREFIX,
  buildAsrPrompt,
  buildFormatSystemPrompt,
  type Style,
} from '../shared/prompts.ts';

const PORT = Number(process.env.API_PORT ?? 8787);
const ASR_MODEL = process.env.ASR_MODEL ?? 'whisper-large-v3-turbo';
const ASR_MODEL_ACCURATE = process.env.ASR_MODEL_ACCURATE ?? 'whisper-large-v3';
const LLM_MODEL = process.env.LLM_MODEL ?? 'openai/gpt-oss-20b';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);
const MIN_SPEECH_MS = 350;

const app = express();
app.disable('x-powered-by');

/**
 * Аудио приходит сырым телом запроса (audio/*), без multipart-парсера:
 * меньше зависимостей и меньше шансов случайно записать файл на диск.
 */
app.use('/api/transcribe', express.raw({ type: 'audio/*', limit: `${MAX_UPLOAD_MB}mb` }));
app.use('/api', express.json({ limit: '256kb' }));

function apiKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim();
  return key ? key : null;
}

function requireKey(res: Response): string | null {
  const key = apiKey();
  if (!key) {
    res.status(503).json({
      error: 'no_key',
      message:
        'GROQ_API_KEY не задан. Скопируйте .env.example в .env и вставьте ключ с console.groq.com/keys.',
    });
    return null;
  }
  return key;
}

function readVocab(req: Request): string[] {
  const raw = req.header('x-speacher-vocab');
  if (!raw) return [];
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= 60)
      .slice(0, 40);
  } catch {
    return [];
  }
}

function pickModel(req: Request): string {
  const requested = req.query.model;
  return requested === 'accurate' ? ASR_MODEL_ACCURATE : ASR_MODEL;
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Health-check: есть ли ключ, отвечает ли Groq, какие модели видит. */
app.get('/api/health', async (_req, res) => {
  const key = apiKey();
  if (!key) {
    res.json({
      ok: false,
      reason: 'no_key',
      message: 'Ключ Groq не настроен — приложение работает, транскрипция недоступна.',
      models: { asr: ASR_MODEL, asrAccurate: ASR_MODEL_ACCURATE, llm: LLM_MODEL },
    });
    return;
  }
  try {
    const models = await listModels(key);
    res.json({
      ok: true,
      models: { asr: ASR_MODEL, asrAccurate: ASR_MODEL_ACCURATE, llm: LLM_MODEL },
      available: {
        asr: models.includes(ASR_MODEL),
        asrAccurate: models.includes(ASR_MODEL_ACCURATE),
        llm: models.includes(LLM_MODEL),
      },
      limits: getLastLimits(),
    });
  } catch (error) {
    const e = error instanceof GroqError ? error : null;
    res.status(502).json({
      ok: false,
      reason: e?.code ?? 'unknown',
      message: e?.message ?? 'Не удалось проверить ключ Groq.',
    });
  }
});

/**
 * POST /api/transcribe
 * body: сырое аудио. query: language=auto|ru|en, model=turbo|accurate, appHint
 * header: x-speacher-vocab (base64url JSON-массив терминов)
 */
app.post('/api/transcribe', async (req, res) => {
  const key = requireKey(res);
  if (!key) return;

  const body = req.body as unknown;
  if (!Buffer.isBuffer(body) || body.byteLength < 1024) {
    res.status(400).json({
      error: 'empty_audio',
      message: 'Аудио не получено или слишком короткое.',
    });
    return;
  }

  const durationMs = asNumber(req.query.durationMs);
  if (durationMs !== undefined && durationMs < MIN_SPEECH_MS) {
    res.status(400).json({
      error: 'too_short',
      message: 'Слишком короткая запись — меньше половины секунды.',
    });
    return;
  }

  const vocab = readVocab(req);
  const language = typeof req.query.language === 'string' ? req.query.language : 'auto';
  const appHint = typeof req.query.appHint === 'string' ? req.query.appHint : undefined;
  const extension = typeof req.query.ext === 'string' ? req.query.ext.replace(/[^a-z0-9]/gi, '') : 'webm';
  const contentType = req.header('content-type') ?? 'audio/webm';
  const started = Date.now();

  try {
    const prompt = buildAsrPrompt({ vocabulary: vocab, appHint, language });

    let result: TranscriptionResult;
    try {
      result = await transcribe({
        apiKey: key,
        audio: body,
        filename: `dictation.${extension || 'webm'}`,
        mimeType: contentType,
        model: pickModel(req),
        language,
        prompt,
      });
    } catch (error) {
      // Один автоматический повтор на временных ошибках — 5xx и таймаут.
      if (error instanceof GroqError && error.code === 'upstream') {
        await new Promise((resolve) => setTimeout(resolve, 600));
        result = await transcribe({
          apiKey: key,
          audio: body,
          filename: `dictation.${extension || 'webm'}`,
          mimeType: contentType,
          model: pickModel(req),
          language,
          prompt,
        });
      } else {
        throw error;
      }
    }

    const noSpeech = result.noSpeechProbability ?? 0;
    if (!result.text || noSpeech > 0.6) {
      res.status(422).json({
        error: 'no_speech',
        message: 'Речь не распознана — похоже, была тишина или очень тихий звук.',
        durationMs: Math.round(result.duration ? result.duration * 1000 : (durationMs ?? 0)),
      });
      return;
    }

    res.json({
      text: result.text,
      detectedLanguage: result.language ?? null,
      audioSeconds:
        result.duration ?? (durationMs !== undefined ? Math.round(durationMs / 100) / 10 : null),
      model: pickModel(req),
      latencyMs: Date.now() - started,
      confidence: {
        noSpeechProbability: noSpeech || null,
        avgLogprob: result.avgLogprob ?? null,
      },
      limits: getLastLimits(),
    });
  } catch (error) {
    sendGroqError(res, error);
  }
});

/**
 * POST /api/format  { text, style, language, vocab, appHint }
 * Возвращает вычищенный текст. При сомнении — исходный, с флагом fallback.
 */
app.post('/api/format', async (req, res) => {
  const key = requireKey(res);
  if (!key) return;

  const body = req.body as {
    text?: unknown;
    style?: unknown;
    language?: unknown;
    vocab?: unknown;
    appHint?: unknown;
  };

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 2) {
    res.status(400).json({ error: 'empty_text', message: 'Нет текста для обработки.' });
    return;
  }
  if (text.length > 12000) {
    res.status(413).json({
      error: 'too_long',
      message: 'Текст длиннее 12 000 символов. Разбейте диктовку на части.',
    });
    return;
  }

  const style: Style =
    body.style === 'message' || body.style === 'email' || body.style === 'code'
      ? body.style
      : 'neutral';
  const vocabulary = Array.isArray(body.vocab)
    ? body.vocab.filter((v): v is string => typeof v === 'string').slice(0, 40)
    : [];
  const language = typeof body.language === 'string' ? body.language : undefined;
  const started = Date.now();

  try {
    const cleaned = await complete({
      apiKey: key,
      model: LLM_MODEL,
      system: buildFormatSystemPrompt({ style, vocabulary, language }),
      user: `${FORMAT_USER_PREFIX}${text}`,
      temperature: 0.2,
      maxTokens: Math.min(4096, Math.ceil(text.length / 2) + 512),
    });

    const cleanedText = cleaned.trim();
    // Защита от «модель дописала за пользователя»: ответ не должен быть
    // заметно длиннее исходника или пустым/обрезанным.
    const suspicious =
      cleanedText.length === 0 ||
      cleanedText.length > text.length * 1.8 + 60 ||
      cleanedText.length < text.length * 0.25;

    res.json({
      text: suspicious ? text : cleanedText,
      fallback: suspicious,
      style,
      model: LLM_MODEL,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof GroqError) {
      // Лишний запрос не должен ломать диктовку: отдаём сырой текст.
      res.json({
        text,
        fallback: true,
        reason: error.code,
        message: error.message,
        latencyMs: Date.now() - started,
      });
      return;
    }
    sendGroqError(res, error);
  }
});

function sendGroqError(res: Response, error: unknown): void {
  if (error instanceof GroqError) {
    if (error.retryAfter !== undefined && error.status === 429) {
      res.setHeader('retry-after', String(error.retryAfter));
    }
    res.status(error.status).json({
      error: error.code,
      message: error.message,
      retryAfter: error.retryAfter,
    });
    return;
  }
  console.error('[unhandled]', error instanceof Error ? error.message : error);
  res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера.' });
}

// В продакшене раздаём собранный фронтенд с того же порта.
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error.message.includes('request entity too large')) {
    res.status(413).json({
      error: 'too_large',
      message: `Аудио больше ${MAX_UPLOAD_MB} МБ. Groq free tier не примет такой файл.`,
    });
    return;
  }
  console.error('[server]', error.message);
  res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[speacher] API на http://0.0.0.0:${PORT}`);
  console.log(
    `[speacher] модели: asr=${ASR_MODEL} accurate=${ASR_MODEL_ACCURATE} llm=${LLM_MODEL}`,
  );
  if (!apiKey()) {
    console.log('[speacher] GROQ_API_KEY не задан — транскрипция вернёт 503.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
