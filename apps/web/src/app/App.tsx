import { useEffect, useMemo, useRef } from 'react';
import { MorphEngine } from '@datenriff/sculpture-core';
import { loadScene } from '../data/loader';
import { getMode } from '../modes/modes';
import { TargetBuilder } from '../sculpture/targets';
import { SculptureView } from '../sculpture/SculptureView';
import { useAtlasStore } from '../state/store';
import { readUrlState } from '../state/url';
import { Header } from '../components/Header';
import { ModeNav } from '../components/ModeNav';
import { Timeline } from '../components/Timeline';
import { Legend } from '../components/Legend';
import { Tooltip } from '../components/Tooltip';
import { Attribution } from '../components/Attribution';
import { Veil } from '../components/Veil';

export default function App() {
  const status = useAtlasStore((s) => s.status);
  const error = useAtlasStore((s) => s.error);
  const scene = useAtlasStore((s) => s.scene);
  const modeId = useAtlasStore((s) => s.modeId);
  const timeT = useAtlasStore((s) => s.timeT);
  const palette = useAtlasStore((s) => s.palette);
  const setScene = useAtlasStore((s) => s.setScene);
  const setError = useAtlasStore((s) => s.setError);
  const bumpSculpture = useAtlasStore((s) => s.bumpSculpture);

  // restore shared URL state before anything renders from it
  const urlApplied = useRef(false);
  if (!urlApplied.current) {
    urlApplied.current = true;
    const url = readUrlState();
    if (url.modeId) useAtlasStore.setState({ modeId: getMode(url.modeId).id });
    if (url.timeT !== undefined) useAtlasStore.setState({ timeT: url.timeT });
    if (url.palette) useAtlasStore.setState({ palette: url.palette });
  }

  useEffect(() => {
    let cancelled = false;
    loadScene()
      .then((s) => !cancelled && setScene(s))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [setScene, setError]);

  const ctx = useMemo(() => {
    if (!scene) return null;
    return { engine: new MorphEngine(scene.count), builder: new TargetBuilder(scene) };
  }, [scene]);

  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // Mode/palette morphs. The first one starts from a flat, transparent
  // sculpture, so loading doubles as the growth animation.
  const firstMorph = useRef(true);
  useEffect(() => {
    if (!ctx) return;
    const target = ctx.builder.build(getMode(modeId), palette);
    if (reducedMotion) {
      ctx.engine.snapTo(target);
    } else {
      ctx.engine.start(target, performance.now(), firstMorph.current ? 1600 : 950);
    }
    firstMorph.current = false;
    bumpSculpture();
  }, [ctx, modeId, palette, reducedMotion, bumpSculpture]);

  // Timeline scrub. Resting at t = 1 is skipped so entering a time-enabled
  // mode doesn't cancel its entry morph.
  const prevTimeT = useRef(1);
  useEffect(() => {
    if (!ctx) return;
    const mode = getMode(modeId);
    const wasScrubbed = prevTimeT.current < 1;
    prevTimeT.current = timeT;
    if (!mode.time || (timeT >= 1 && !wasScrubbed)) return;
    const target = ctx.builder.build(mode, palette);
    const steps = mode.time.steps;
    const a = target.timeHeights?.get(steps[0]!);
    const b = target.timeHeights?.get(steps[steps.length - 1]!);
    if (!a || !b) return;
    ctx.engine.setHeightMix(a, b, timeT);
    bumpSculpture();
  }, [ctx, modeId, timeT, palette, bumpSculpture]);

  const mode = getMode(modeId);
  const modeTarget = ctx ? ctx.builder.build(mode, palette) : null;

  return (
    <div className="atlas">
      {scene && ctx && <SculptureView scene={scene} engine={ctx.engine} />}
      {scene && <Header mode={mode} />}
      {scene && <ModeNav />}
      {scene && mode.time && <Timeline mode={mode} />}
      {scene && modeTarget && (
        <Legend mode={mode} scene={scene} colorStats={modeTarget.colorStats} />
      )}
      {scene && ctx && <Tooltip mode={mode} scene={scene} builder={ctx.builder} />}
      {scene && <Attribution scene={scene} />}
      <Veil visible={status !== 'ready'} error={error} />
    </div>
  );
}
