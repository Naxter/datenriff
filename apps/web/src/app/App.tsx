import { useEffect, useMemo, useRef } from 'react';
import { MorphEngine } from '@datenriff/sculpture-core';
import { loadManifest, loadScene, resolveDataset } from '../data/loader';
import { availableModes, datasetServesMode, getMode } from '../modes/modes';
import { detectQuality } from '../sculpture/quality';
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
import { ExportButton } from '../components/ExportButton';
import { StoryPlayer } from '../components/StoryPlayer';
import { Veil } from '../components/Veil';
import { INTRO_GROWTH_MS, introEligible, runIntro } from './intro';

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

  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // restore shared URL state before anything renders from it, and decide
  // about the opening sequence before the first growth morph can fire
  const urlApplied = useRef(false);
  if (!urlApplied.current) {
    urlApplied.current = true;
    const url = readUrlState();
    if (url.modeId) useAtlasStore.setState({ modeId: getMode(url.modeId).id });
    if (url.timeT !== undefined) useAtlasStore.setState({ timeT: url.timeT });
    if (url.palette) useAtlasStore.setState({ palette: url.palette });
    if (introEligible(reducedMotion)) useAtlasStore.setState({ introPhase: 'title' });
  }
  const introPhase = useAtlasStore((s) => s.introPhase);
  const setIntroPhase = useAtlasStore((s) => s.setIntroPhase);

  const manifest = useAtlasStore((s) => s.manifest);
  const setManifest = useAtlasStore((s) => s.setManifest);

  // GPU budget: decides country LOD, DPR, shadows, labels, tile streaming
  const quality = useMemo(() => detectQuality(), []);

  useEffect(() => {
    let cancelled = false;
    loadManifest()
      .then((m) => !cancelled && setManifest(m))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [setManifest, setError]);

  // A mode may live in a different dataset (AFTER DARK is a satellite raster
  // with its own cell universe), so the scene follows the mode.
  const wantedDatasetId = useMemo(() => {
    if (!manifest) return null;
    const mode = getMode(modeId);
    const dataset = resolveDataset(manifest, mode, (d) =>
      datasetServesMode(d, mode),
    );
    return dataset?.id ?? null;
  }, [manifest, modeId]);

  // Only the very first scene shows the veil. A later dataset switch keeps
  // the current sculpture on screen until the new one has arrived, then the
  // view cross-morphs (old sinks into the plane, new grows out of it).
  useEffect(() => {
    if (!manifest || !wantedDatasetId) return;
    if (scene?.dataset.id === wantedDatasetId) return;
    let cancelled = false;
    useAtlasStore.setState(scene ? { sceneLoading: true } : { status: 'loading' });
    loadScene(manifest, wantedDatasetId, quality)
      .then((s) => !cancelled && setScene(s))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      useAtlasStore.setState({ sceneLoading: false });
    };
  }, [manifest, wantedDatasetId, scene, quality, setScene, setError]);

  // no dataset can serve the requested mode → fall back to one that works
  useEffect(() => {
    if (!manifest) return;
    const modes = availableModes(manifest.datasets);
    if (modes.length > 0 && !modes.some((m) => m.id === modeId)) {
      useAtlasStore.setState({ modeId: modes[0]!.id, timeT: 1 });
    }
  }, [manifest, modeId]);

  const ctx = useMemo(() => {
    if (!scene) return null;
    return { engine: new MorphEngine(scene.count), builder: new TargetBuilder(scene) };
  }, [scene]);

  // Between a mode switch and the matching scene arriving, the loaded scene
  // cannot serve the mode (AFTER DARK → PEOPLE swaps datasets). The sculpture
  // stays up showing the last mode it could serve; only the target builder
  // waits for `ready`.
  const mode = getMode(modeId);
  const ready = ctx !== null && scene !== undefined && datasetServesMode(scene.dataset, mode);
  const shownModeId = useRef(modeId);
  if (ready) shownModeId.current = modeId;
  const shownMode = getMode(shownModeId.current);

  // Opening sequence: the timers start once the first scene is on screen
  // and must survive the title → reveal step, hence the coarse dependency.
  const introOn = introPhase === 'title' || introPhase === 'reveal';
  useEffect(() => {
    if (!ready || !introOn) return;
    if (useAtlasStore.getState().introPhase !== 'title') return;
    return runIntro(setIntroPhase);
  }, [ready, introOn, setIntroPhase]);

  // Mode/palette morphs. A fresh engine (first load, new dataset) grows out
  // of the plane in its own colours; later switches blend between modes.
  // During the intro's title phase the sculpture is held flat.
  const firstMorph = useRef(true);
  useEffect(() => {
    if (!ctx || !ready || introPhase === 'title') return;
    const target = ctx.builder.build(getMode(modeId), palette);
    if (reducedMotion) {
      ctx.engine.snapTo(target);
    } else if (ctx.engine.isPristine) {
      const ms = introPhase === 'reveal' ? INTRO_GROWTH_MS : firstMorph.current ? 1600 : 1100;
      ctx.engine.growFromFlat(target, performance.now(), ms);
    } else {
      ctx.engine.start(target, performance.now(), 950);
    }
    firstMorph.current = false;
    bumpSculpture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ready, modeId, palette, reducedMotion, bumpSculpture, introPhase === 'title']);

  // Timeline scrub. Resting at t = 1 is skipped so entering a time-enabled
  // mode doesn't cancel its entry morph.
  const prevTimeT = useRef(1);
  useEffect(() => {
    if (!ctx || !ready) return;
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
  }, [ctx, ready, modeId, timeT, palette, bumpSculpture]);

  // `shown` is what the sculpture on screen actually depicts: the current
  // mode once its scene is loaded, else the last mode this scene served.
  const shown = ctx !== null && scene !== undefined && datasetServesMode(scene.dataset, shownMode);
  const shownTarget = shown ? ctx.builder.build(shownMode, palette) : null;

  return (
    <div className={`atlas${introOn ? ' atlas--intro' : ''}`}>
      {ctx && scene && <SculptureView scene={scene} engine={ctx.engine} />}
      {scene && <Header mode={mode} />}
      {manifest && <ModeNav />}
      {ready && mode.time && <Timeline mode={mode} />}
      {shown && shownTarget && (
        <Legend mode={shownMode} scene={scene} colorStats={shownTarget.colorStats} />
      )}
      {shown && <Tooltip mode={shownMode} scene={scene} builder={ctx.builder} />}
      {ready && <ExportButton builder={ctx.builder} />}
      {ready && <StoryPlayer mode={mode} />}
      {scene && <Attribution scene={scene} />}
      <Veil
        visible={status !== 'ready' || !scene}
        intro={introOn ? introPhase : null}
        error={error}
      />
    </div>
  );
}
