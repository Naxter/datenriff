// Drag through the time steps; play sweeps once end-to-end. With more than
// two steps the current one is read out in the middle. Reduced motion
// plays step by step instead of sweeping.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SculptureMode } from '@datenriff/data-contracts';
import { nearestStep, stepT, sweepDuration } from '../modes/time';
import { resolveReducedMotion } from '../state/settings';
import { useAtlasStore } from '../state/store';

export function Timeline({ mode }: { mode: SculptureMode }) {
  const timeT = useAtlasStore((s) => s.timeT);
  const setTimeT = useAtlasStore((s) => s.setTimeT);
  const settings = useAtlasStore((s) => s.settings);
  const reducedMotion = useMemo(() => resolveReducedMotion(settings), [settings]);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const steps = mode.time?.steps ?? [];
  const n = steps.length;

  useEffect(() => {
    if (!playing || n < 2) return;
    if (reducedMotion) {
      // discrete: one step per beat, no sweeping
      let index = timeT >= 1 ? 0 : nearestStep(timeT, n);
      setTimeT(stepT(index, n));
      const timer = setInterval(() => {
        index += 1;
        setTimeT(stepT(index, n));
        if (index >= n - 1) {
          clearInterval(timer);
          setPlaying(false);
        }
      }, 900);
      return () => clearInterval(timer);
    }
    const startT = timeT >= 1 ? 0 : timeT;
    const t0 = performance.now();
    const duration = sweepDuration(n);
    const loop = (now: number) => {
      const t = startT + (now - t0) / duration;
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
  }, [playing, n, reducedMotion]);

  // leaving the mode stops the sweep
  useEffect(() => () => setPlaying(false), [mode.id]);

  if (!mode.time || n < 2) return null;
  const first = steps[0]!;
  const last = steps[n - 1]!;
  const current = steps[nearestStep(timeT, n)]!;

  return (
    <div className="timeline">
      <span className={`timeline__year${timeT < 0.5 ? ' timeline__year--active' : ''}`}>
        {first}
      </span>
      <div className="timeline__track">
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={timeT}
          aria-label={`Timeline ${first} to ${last}`}
          aria-valuetext={current}
          onChange={(e) => {
            setPlaying(false);
            setTimeT(Number(e.target.value));
          }}
        />
        {n > 2 && (
          <span className="timeline__current" aria-hidden="true">
            {current}
          </span>
        )}
      </div>
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
