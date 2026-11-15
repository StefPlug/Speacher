/**
 * Один проход диктовки: аудио → Groq Whisper → LLM-чистка.
 * Общий модуль для расширения и веб-версии: никакого DOM и никаких chrome.*,
 * на входе ключ и настройки, на выходе готовый текст.
 */
import {
  GroqClientError,
  formatWithGroq,
  transcribeWithGroq,
  type GroqSettings,
} from './groq-client';
import { FORMAT_USER_PREFIX, buildAsrPrompt, buildFormatSystemPrompt } from './prompts';

export type PipelineResult = {
  raw: string;
  clean: string;
  fallback: boolean;
  language: string | null;
  asrMs: number;
  formatMs: number | null;
  detectedNoSpeech: number | null;
  notice: string | null;
};

export async function runPipeline(opts: {
  blob: Blob;
  settings: GroqSettings;
  vocabulary: string[];
  modelChoice: 'turbo' | 'accurate';
  host?: string | null;
}): Promise<PipelineResult> {
  const { settings, vocabulary } = opts;
  const asrModel = opts.modelChoice === 'accurate' ? settings.asrModelAccurate : settings.asrModel;

  const asrStarted = performance.now();
  const asr = await transcribeWithGroq({
    apiKey: settings.apiKey,
    blob: opts.blob,
    model: asrModel,
    language: settings.language,
    prompt: buildAsrPrompt({ vocabulary, language: settings.language }),
  });
  const asrMs = Math.round(performance.now() - asrStarted);

  if (!asr.text) {
    throw new GroqClientError({
      code: 'no_speech',
      message: 'Речь не распознана — похоже, была тишина.',
    });
  }
  if ((asr.noSpeechProbability ?? 0) > 0.6) {
    throw new GroqClientError({
      code: 'no_speech',
      message: 'Речь не распознана — похоже, была тишина или очень тихий звук.',
    });
  }

  if (!settings.cleanup) {
    return {
      raw: asr.text,
      clean: asr.text,
      fallback: false,
      language: asr.language,
      asrMs,
      formatMs: null,
      detectedNoSpeech: asr.noSpeechProbability,
      notice: null,
    };
  }

  const formatStarted = performance.now();
  try {
    const cleaned = await formatWithGroq({
      apiKey: settings.apiKey,
      model: settings.llmModel,
      system: buildFormatSystemPrompt({
        style: settings.style,
        vocabulary,
        language: settings.language,
      }),
      user: `${FORMAT_USER_PREFIX}${asr.text}`,
      maxTokens: Math.min(4096, Math.ceil(asr.text.length / 2) + 512),
    });

    // Защита от «модель дописала за пользователя».
    const suspicious =
      cleaned.length === 0 ||
      cleaned.length > asr.text.length * 1.8 + 60 ||
      cleaned.length < asr.text.length * 0.25;

    return {
      raw: asr.text,
      clean: suspicious ? asr.text : cleaned,
      fallback: suspicious,
      language: asr.language,
      asrMs,
      formatMs: Math.round(performance.now() - formatStarted),
      detectedNoSpeech: asr.noSpeechProbability,
      notice: suspicious ? 'Чистка вернула странный результат — оставлен дословный текст.' : null,
    };
  } catch (error) {
    // Чистка не должна ломать диктовку.
    return {
      raw: asr.text,
      clean: asr.text,
      fallback: true,
      language: asr.language,
      asrMs,
      formatMs: Math.round(performance.now() - formatStarted),
      detectedNoSpeech: asr.noSpeechProbability,
      notice:
        error instanceof GroqClientError
          ? `Чистка недоступна: ${error.message}`
          : 'Чистка недоступна.',
    };
  }
}
