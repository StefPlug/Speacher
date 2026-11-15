import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'requesting' | 'recording';

export type Recording = {
  blob: Blob;
  durationMs: number;
  levelHistory: number[];
};

const BAR_COUNT = 28;

function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const levelsRef = useRef<number[]>([]);
  const mimeRef = useRef('');

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Браузер не даёт доступ к микрофону. Нужен https или localhost.');
      return;
    }

    setState('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      setState('idle');
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Доступ к микрофону запрещён. Разрешите его в настройках браузера и попробуйте снова.');
      } else if (name === 'NotFoundError') {
        setError('Микрофон не найден. Подключите устройство записи.');
      } else {
        setError('Не удалось открыть микрофон.');
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    levelsRef.current = [];

    const mimeType = pickMimeType();
    mimeRef.current = mimeType;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.start(250);
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setState('recording');

    // Визуализация громкости: RMS из анализатора.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyserRef.current = analyser;
    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      const node = analyserRef.current;
      if (!node) return;
      node.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const scaled = Math.min(1, rms * 4.2);
      setLevel(scaled);
      levelsRef.current.push(scaled);
      if (levelsRef.current.length > 2000) levelsRef.current.shift();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    timerRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 100);
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    chunksRef.current = [];
    cleanup();
    setLevel(0);
    setElapsedMs(0);
    setState('idle');
  }, [cleanup]);

  const stop = useCallback((): Promise<Recording> => {
    return new Promise((resolve, reject) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanup();
        setState('idle');
        reject(new Error('Запись не была начата.'));
        return;
      }

      const durationMs = performance.now() - startedAtRef.current;

      recorder.onstop = () => {
        const type = mimeRef.current || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const levelHistory = levelsRef.current.slice(-BAR_COUNT * 6);
        cleanup();
        setLevel(0);
        setState('idle');
        if (blob.size < 1024) {
          reject(new Error('Запись получилась пустой — попробуйте ещё раз.'));
          return;
        }
        resolve({ blob, durationMs, levelHistory });
      };

      recorder.stop();
    });
  }, [cleanup]);

  return { state, error, elapsedMs, level, start, stop, cancel, setError };
}
