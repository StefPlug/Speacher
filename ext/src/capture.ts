/** Запись с микрофона в offscreen-документе: MediaRecorder + RMS для волны. */

export type Recording = {
  blob: Blob;
  durationMs: number;
};

type LevelListener = (level: number) => void;

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let audioCtx: AudioContext | null = null;
let raf: number | null = null;
let mime = '';
let lastSent = 0;
let startedAt = 0;

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function teardown(): void {
  if (raf !== null) {
    cancelAnimationFrame(raf);
    raf = null;
  }
  if (audioCtx && audioCtx.state !== 'closed') void audioCtx.close();
  audioCtx = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  recorder = null;
}

export async function startCapture(onLevel: LevelListener): Promise<void> {
  teardown();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  chunks = [];
  mime = pickMime();
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(250);
  startedAt = performance.now();

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);
  const buffer = new Uint8Array(analyser.fftSize);

  const tick = () => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = (buffer[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.min(1, Math.sqrt(sum / buffer.length) * 4.2);
    const now = performance.now();
    if (now - lastSent > 90) {
      lastSent = now;
      onLevel(level);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function stopCapture(): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const active = recorder;
    if (!active || active.state === 'inactive') {
      teardown();
      reject(new Error('Запись не была начата.'));
      return;
    }

    const durationMs = Math.round(performance.now() - startedAt);
    active.onstop = () => {
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      chunks = [];
      teardown();
      if (blob.size < 1024) {
        reject(new Error('Запись получилась пустой — попробуйте ещё раз.'));
        return;
      }
      resolve({ blob, durationMs });
    };
    active.stop();
  });
}

export function cancelCapture(): void {
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null;
    recorder.stop();
  }
  chunks = [];
  teardown();
}
