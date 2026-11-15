import type { ApiError, LanguageChoice, ModelChoice, Style } from './types';

export type HealthResponse =
  | {
      ok: true;
      models: { asr: string; asrAccurate: string; llm: string };
      available: { asr: boolean; asrAccurate: boolean; llm: boolean };
    }
  | { ok: false; reason: string; message: string; models?: { asr: string; llm: string } };

export type TranscribeResponse = {
  text: string;
  detectedLanguage: string | null;
  audioSeconds: number | null;
  model: string;
  latencyMs: number;
  confidence: { noSpeechProbability: number | null; avgLogprob: number | null };
};

export type FormatResponse = {
  text: string;
  fallback: boolean;
  style: Style;
  model?: string;
  latencyMs: number;
  reason?: string;
  message?: string;
};

function encodeVocab(vocabulary: string[]): string | null {
  if (vocabulary.length === 0) return null;
  const json = JSON.stringify(vocabulary);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const data = (await response.json()) as Partial<ApiError>;
    return {
      error: data.error ?? 'unknown',
      message: data.message ?? `Ошибка ${response.status}`,
      retryAfter: data.retryAfter,
    };
  } catch {
    return { error: 'unknown', message: `Ошибка ${response.status}` };
  }
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal });
  return (await response.json()) as HealthResponse;
}

export async function transcribeAudio(opts: {
  blob: Blob;
  durationMs: number;
  language: LanguageChoice;
  model: ModelChoice;
  vocabulary: string[];
  signal?: AbortSignal;
}): Promise<TranscribeResponse> {
  const params = new URLSearchParams({
    language: opts.language,
    model: opts.model,
    durationMs: String(Math.round(opts.durationMs)),
    ext: opts.blob.type.includes('mp4') ? 'mp4' : opts.blob.type.includes('ogg') ? 'ogg' : 'webm',
  });

  const headers: Record<string, string> = {
    'content-type': opts.blob.type || 'audio/webm',
  };
  const vocab = encodeVocab(opts.vocabulary);
  if (vocab) headers['x-speacher-vocab'] = vocab;

  const response = await fetch(`/api/transcribe?${params.toString()}`, {
    method: 'POST',
    body: opts.blob,
    headers,
    signal: opts.signal,
  });

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as TranscribeResponse;
}

export async function formatText(opts: {
  text: string;
  style: Style;
  language: LanguageChoice;
  vocabulary: string[];
  signal?: AbortSignal;
}): Promise<FormatResponse> {
  const response = await fetch('/api/format', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: opts.text,
      style: opts.style,
      language: opts.language,
      vocab: opts.vocabulary,
    }),
    signal: opts.signal,
  });

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as FormatResponse;
}
