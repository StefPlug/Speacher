import { useEffect, useRef } from 'react';

type Props = {
  level: number;
  active: boolean;
  busy?: boolean;
  bars?: number;
};

/**
 * Волна в стиле референса: тонкие вертикальные полосы, выше в центре,
 * реагируют на громкость. В состоянии обработки — мягкая «рябь».
 */
export function Waveform({ level, active, busy = false, bars = 28 }: Props) {
  const heightsRef = useRef<number[]>(Array.from({ length: bars }, () => 0.12));
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let phase = 0;

    const render = () => {
      phase += busy ? 0.09 : 0.05;
      const nodes = containerRef.current?.children;
      if (nodes) {
        for (let i = 0; i < nodes.length; i += 1) {
          const centerBias = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
          let target: number;
          if (busy) {
            target = 0.18 + 0.32 * Math.abs(Math.sin(phase + i * 0.45)) * (0.5 + centerBias);
          } else if (active) {
            const jitter = 0.55 + 0.45 * Math.sin(phase * 1.7 + i * 0.8);
            target = Math.max(0.08, level * (0.45 + centerBias * 0.85) * jitter);
          } else {
            target = 0.1 + 0.04 * centerBias;
          }
          const previous = heightsRef.current[i] ?? 0.1;
          // Сглаживание, чтобы полосы не дёргались.
          const next = previous + (target - previous) * (active ? 0.35 : 0.16);
          heightsRef.current[i] = next;
          const element = nodes[i] as HTMLElement;
          const height = Math.round(6 + next * 26);
          element.style.height = `${height}px`;
          element.style.opacity = String(active || busy ? 0.55 + next * 0.45 : 0.35);
        }
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [level, active, busy, bars]);

  return (
    <div ref={containerRef} className="flex h-9 items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-rose-200 transition-colors"
          style={{ height: '8px' }}
        />
      ))}
    </div>
  );
}
