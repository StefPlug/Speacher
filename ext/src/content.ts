/**
 * Content script: показывает пилюлю поверх страницы.
 * Ничего не читает со страницы и не отправляет наружу — только рисует оверлей.
 */

type Mode = 'listening' | 'processing' | 'done' | 'hide';

type PillElements = {
  host: HTMLDivElement;
  pill: HTMLDivElement;
  bars: HTMLSpanElement[];
  timer: HTMLSpanElement;
  label: HTMLSpanElement;
  dot: HTMLSpanElement;
};

const BAR_COUNT = 22;
let elements: PillElements | null = null;
let level = 0;
let raf = 0;
let phase = 0;
let mode: Mode = 'hide';
let startedAt = 0;
let hideTimer: number | null = null;

const PILL_Z_INDEX = '2147483647';

function createPill(): PillElements {
  const host = document.createElement('div');
  host.id = 'speacher-pill-root';
  host.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:28px',
    'transform:translateX(-50%)',
    `z-index:${PILL_Z_INDEX}`,
    'pointer-events:none',
    'display:none',
  ].join(';');

  const pill = document.createElement('div');
  pill.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:14px',
    'padding:11px 16px',
    'border-radius:999px',
    'background:#141414',
    'color:#fbf8f3',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size:13px',
    'line-height:1',
    'box-shadow:0 1px 1px rgba(0,0,0,.08),0 12px 32px -8px rgba(0,0,0,.45)',
    'pointer-events:auto',
    'user-select:none',
    'white-space:nowrap',
    'max-width:min(520px,90vw)',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = [
    'width:9px',
    'height:9px',
    'border-radius:999px',
    'background:#f5c6d6',
    'flex:0 0 auto',
  ].join(';');

  const barsWrap = document.createElement('div');
  barsWrap.style.cssText = 'display:flex;align-items:center;gap:3px;flex:0 0 auto';
  const bars: HTMLSpanElement[] = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const bar = document.createElement('span');
    bar.style.cssText = [
      'width:3px',
      'height:7px',
      'border-radius:999px',
      'background:#f8d7e2',
      'transition:height .08s linear,opacity .2s',
      'display:block',
    ].join(';');
    barsWrap.appendChild(bar);
    bars.push(bar);
  }

  const timer = document.createElement('span');
  timer.textContent = '0:00';
  timer.style.cssText =
    'font-variant-numeric:tabular-nums;color:rgba(251,248,243,.75);min-width:32px;flex:0 0 auto';

  const label = document.createElement('span');
  label.textContent = '';
  label.style.cssText = 'color:rgba(251,248,243,.85);max-width:320px;overflow:hidden;text-overflow:ellipsis';

  pill.append(dot, barsWrap, timer, label);
  host.appendChild(pill);
  document.documentElement.appendChild(host);

  return { host, pill, bars, timer, label, dot };
}

function ensure(): PillElements {
  if (elements && document.documentElement.contains(elements.host)) return elements;
  elements = createPill();
  return elements;
}

function formatTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function renderBars(): void {
  if (!elements) return;
  phase += 0.08;
  const now = performance.now();
  if (mode === 'listening') elements.timer.textContent = formatTimer(now - startedAt);

  elements.bars.forEach((bar, index) => {
    const centerBias = 1 - Math.abs(index - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
    let height: number;
    if (mode === 'processing' || mode === 'done') {
      height = 7 + Math.abs(Math.sin(phase + index * 0.5)) * 12 * (0.4 + centerBias);
    } else {
      const jitter = 0.55 + 0.45 * Math.sin(phase * 1.7 + index * 0.9);
      height = 5 + level * (6 + centerBias * 20) * jitter;
    }
    bar.style.height = `${Math.round(height)}px`;
  });
  raf = requestAnimationFrame(renderBars);
}

function startRendering(): void {
  if (raf) return;
  raf = requestAnimationFrame(renderBars);
}

function stopRendering(): void {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function show(nextMode: Exclude<Mode, 'hide'>, text?: string): void {
  const el = ensure();
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  mode = nextMode;
  if (nextMode === 'listening') startedAt = performance.now();
  el.host.style.display = 'block';

  el.timer.style.display = nextMode === 'listening' ? 'inline' : 'none';
  el.dot.style.display = nextMode === 'processing' ? 'none' : 'block';
  el.label.textContent =
    nextMode === 'listening'
      ? 'Слушаю…'
      : nextMode === 'processing'
        ? (text ?? 'Распознаём…')
        : (text ?? 'Готово');

  startRendering();

  if (nextMode === 'done') {
    hideTimer = window.setTimeout(() => hide(), 2200);
  }
}

function hide(): void {
  if (!elements) return;
  mode = 'hide';
  elements.host.style.display = 'none';
  stopRendering();
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type?: string; mode?: Mode; text?: string; level?: number };
  if (msg.type === 'pill' && msg.mode) {
    if (msg.mode === 'hide') hide();
    else show(msg.mode, msg.text);
  }
  if (msg.type === 'pill-level' && typeof msg.level === 'number') {
    level = msg.level;
  }
  return false;
});

// Страница могла перерисоваться (SPA) — вернём пилюлю, если она нужна.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mode !== 'hide') {
    void chrome.runtime.sendMessage({ type: 'get-state' }).catch(() => undefined);
  }
});
