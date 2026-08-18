// Drag between the first and last time step; play sweeps once end-to-end.

import { useEffect, useRef, useState } from 'react';
import type { SculptureMode } from '@datenriff/data-contracts';
import { useAtlasStore } from '../state/store';

export function Timeline({ mode }: { mode: SculptureMode }) {
  const timeT = useAtlasStore((s) => s.timeT);
  const setTimeT = useAtlasStore((s) => s.setTimeT);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const startT = timeT >= 1 ? 0 : timeT;
    const t0 = performance.now();
    const DURATION = 2600;
    const loop = (now: number) => {
      const t = startT + (now - t0) / DURATION;
      if (t >= 1) {
        setTimeT(1);
        setPlaying(false);
        return;
      }
      setTimeT(t);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (!mode.time) return null;
  const steps = mode.time.steps;
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;

  return (
    <div className="timeline">
      <span className={`timeline__year${timeT < 0.5 ? ' timeline__year--active' : ''}`}>
        {first}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={timeT}
        aria-label={`Timeline ${first} to ${last}`}
        onChange={(e) => {
          setPlaying(false);
          setTimeT(Number(e.target.value));
        }}
      />
      <span className={`timeline__year${timeT >= 0.5 ? ' timeline__year--active' : ''}`}>
        {last}
      </span>
      <button
        type="button"
        className="timeline__play"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => setPlaying((p) => !p)}
      >
        {playing ? '❚❚' : '▶'}
      </button>
    </div>
  );
}
