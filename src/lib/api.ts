/**
 * Веб-версия работает без сервера: тот же общий конвейер, что и в расширении,
 * ключ Groq вводится в настройках и живёт в localStorage этого браузера.
 */
import {
  GroqClientError,
  checkKey,
  formatWithGroq,
  type GroqSettings,
} from '../../shared/groq-client';
import { FORMAT_USER_PREFIX, buildFormatSystemPrompt } from '../../shared/prompts';
import { runPipeline, type PipelineResult } from '../../shared/pipeline';
import { sanitizeSettings, type SpeacherSettings } from '../../shared/settings';

export { GroqClientError, checkKey };
export type { PipelineResult };

export type RunOutcome = {
  raw: string;
  clean: string;
  fallback: boolean;
  language: string | null;
  asrMs: number;
  formatMs: number | null;
  notice: string | null;
};

function groqSettings(settings: SpeacherSettings): GroqSettings {
  return {
    apiKey: sanitizeSettings(settings).apiKey,
    asrModel: settings.asrModel,
    asrModelAccurate: settings.asrModelAccurate,
    llmModel: settings.llmModel,
    language: settings.language,
    style: settings.style,
    cleanup: settings.cleanup,
  };
}

export async function runDictation(opts: {
  blob: Blob;
  settings: SpeacherSettings;
  modelChoice: 'turbo' | 'accurate';
}): Promise<RunOutcome> {
  const result = await runPipeline({
    blob: opts.blob,
    settings: groqSettings(opts.settings),
    vocabulary: opts.settings.vocabulary,
    modelChoice: opts.modelChoice,
    host: null,
  });
  return {
    raw: result.raw,
    clean: result.clean,
    fallback: result.fallback,
    language: result.language,
    asrMs: result.asrMs,
    formatMs: result.formatMs,
    notice: result.notice,
  };
}

/** Повторная чистка уже готовой расшифровки при смене стиля. */
export async function reformat(opts: {
  raw: string;
  style: SpeacherSettings['style'];
  settings: SpeacherSettings;
}): Promise<{ text: string; fallback: boolean }> {
  try {
    const cleaned = await formatWithGroq({
      apiKey: opts.settings.apiKey,
      model: opts.settings.llmModel,
      system: buildFormatSystemPrompt({
        style: opts.style,
        vocabulary: opts.settings.vocabulary,
        language: opts.settings.language,
      }),
      user: `${FORMAT_USER_PREFIX}${opts.raw}`,
      maxTokens: Math.min(4096, Math.ceil(opts.raw.length / 2) + 512),
    });
    const suspicious =
      cleaned.length === 0 ||
      cleaned.length > opts.raw.length * 1.8 + 60 ||
      cleaned.length < opts.raw.length * 0.25;
    return { text: suspicious ? opts.raw : cleaned, fallback: suspicious };
  } catch {
    return { text: opts.raw, fallback: true };
  }
}
