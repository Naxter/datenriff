import { useEffect, useMemo, useRef, useState } from 'react';
import { MorphEngine } from '@datenriff/sculpture-core';
import { loadManifest, loadScene, requiredMetrics, resolveDataset } from '../data/loader';
import { availableModes, datasetServesMode, getMode } from '../modes/modes';
import { TargetBuilder } from '../sculpture/targets';
import { SculptureView } from '../sculpture/SculptureView';
import { useAtlasStore } from '../state/store';
import { readUrlState } from '../state/url';
import { resolveReducedMotion } from '../state/settings';
import { Header } from '../components/Header';
import { ModeNav } from '../components/ModeNav';
import { Timeline } from '../components/Timeline';
import { Legend } from '../components/Legend';
import { Tooltip } from '../components/Tooltip';
import { Wordmark } from '../components/Wordmark';
import { Toolbar } from '../components/Toolbar';
import { PageLinks } from '../components/PageLinks';
import { AboutPanel } from '../components/AboutPanel';
import { StoryPlayer } from '../components/StoryPlayer';
import { Veil } from '../components/Veil';
import { INTRO_GROWTH_MS, introEligible, runIntro } from './intro';
import { timeSegment } from '../modes/time';
import { resolveFocus } from '../data/focusData';

export default function App() {
  const status = useAtlasStore((s) => s.status);
  const error = useAtlasStore((s) => s.error);
  const scene = useAtlasStore((s) => s.scene);
  const modeId = useAtlasStore((s) => s.modeId);
  const timeT = useAtlasStore((s) => s.timeT);
  const palette = useAtlasStore((s) => s.palette);
  const setScene = useAtlasStore((s) => s.setScene);
  const sceneLoading = useAtlasStore((s) => s.sceneLoading);
  const aboutOpen = useAtlasStore((s) => s.aboutOpen);
  const setError = useAtlasStore((s) => s.setError);
  const bumpSculpture = useAtlasStore((s) => s.bumpSculpture);

  const settings = useAtlasStore((s) => s.settings);
  const reducedMotion = useMemo(() => resolveReducedMotion(settings), [settings]);

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
  const focus = useAtlasStore((s) => s.focus);

  const manifest = useAtlasStore((s) => s.manifest);
  const setManifest = useAtlasStore((s) => s.setManifest);

  // GPU budget: decides country LOD, DPR, shadows, labels, tile streaming;
  // follows the viewer's quality setting
  const quality = useAtlasStore((s) => s.quality);

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

  // Only the very first scene shows the veil. A dataset switch is a piece
  // of choreography: the sculpture on screen sinks into the plane at once,
  // the wait is spent on an empty page with a progress hairline, and the
  // new data grows out of the plane when it is all there. RAIN is 25 years
  // of country LOD — long enough that standing still reads as a freeze.
  useEffect(() => {
    if (!manifest || !wantedDatasetId) return;
    if (scene?.dataset.id === wantedDatasetId && scene.profileId === quality.id) return;
    let cancelled = false;
    useAtlasStore.setState(
      scene ? { sceneLoading: true, sceneProgress: 0 } : { status: 'loading' },
    );
    engineRef.current?.fadeOut(performance.now(), 700);
    bumpSculpture();
    const target = manifest.datasets.find((d) => d.id === wantedDatasetId);
    const opening = target ? requiredMetrics(target, getMode(modeId, target)) : undefined;
    loadScene(
      manifest,
      wantedDatasetId,
      quality,
      (fraction) => {
        if (!cancelled) useAtlasStore.setState({ sceneProgress: fraction });
      },
      opening,
    )
      .then((s) => !cancelled && setScene(s))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      useAtlasStore.setState({ sceneLoading: false });
    };
  }, [manifest, wantedDatasetId, scene, quality, modeId, setScene, setError, bumpSculpture]);

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
  // the effect above runs before a new ctx exists, so it sinks the engine
  // that is still on screen through this handle
  const engineRef = useRef<MorphEngine | null>(null);
  engineRef.current = ctx?.engine ?? null;

  // Between a mode switch and the matching scene arriving, the loaded scene
  // cannot serve the mode (AFTER DARK → PEOPLE swaps datasets). The sculpture
  // stays up showing the last mode it could serve; only the target builder
  // waits for `ready`.
  const mode = getMode(modeId, scene?.dataset);
  // Once the picture is up, quietly fetch the rest of the dataset so a mode
  // switch has its buffers ready without another wait.
  useEffect(() => {
    if (!scene) return;
    const id = window.setTimeout(() => scene.loadRest(), 400);
    return () => window.clearTimeout(id);
  }, [scene]);

  // A mode switched to before its buffers land: fetch them, and hold the
  // sculpture on the last mode that can be drawn until they are in.
  const [metricsVersion, setMetricsVersion] = useState<number>(0);
  const missing = useMemo(() => {
    if (!scene) return [];
    return [...requiredMetrics(scene.dataset, mode)].filter((id) => scene.pending.has(id));
  }, [scene, mode, metricsVersion]);
  useEffect(() => {
    if (!scene || missing.length === 0) return;
    let cancelled = false;
    useAtlasStore.setState({ sceneLoading: true });
    void scene.ensure(missing).then(() => {
      if (cancelled) return;
      useAtlasStore.setState({ sceneLoading: false });
      setMetricsVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [scene, missing]);

  const ready =
    ctx !== null &&
    scene !== undefined &&
    datasetServesMode(scene.dataset, mode) &&
    missing.length === 0;
  const shownModeId = useRef(modeId);
  if (ready) shownModeId.current = modeId;
  const shownMode = getMode(shownModeId.current, scene?.dataset);

  // a shared ?focus= is resolved once the data to resolve it against exists
  const urlFocusApplied = useRef(false);
  useEffect(() => {
    if (!scene || !manifest || urlFocusApplied.current) return;
    urlFocusApplied.current = true;
    const wanted = readUrlState().focus;
    if (!wanted) return;
    void resolveFocus(wanted, manifest, scene).then((f) => {
      if (f) useAtlasStore.getState().setFocus(f);
    });
  }, [scene, manifest]);

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
    const target = ctx.builder.build(getMode(modeId, ctx.builder.dataset), palette, focus);
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
  }, [ctx, ready, modeId, palette, focus, reducedMotion, bumpSculpture, introPhase === 'title']);

  // Timeline scrub. Resting at t = 1 is skipped so entering a time-enabled
  // mode doesn't cancel its entry morph.
  const prevTimeT = useRef(1);
  useEffect(() => {
    if (!ctx || !ready) return;
    const mode = getMode(modeId, ctx.builder.dataset);
    const wasScrubbed = prevTimeT.current < 1;
    prevTimeT.current = timeT;
    if (!mode.time || (timeT >= 1 && !wasScrubbed)) return;
    const target = ctx.builder.build(mode, palette, focus);
    const steps = mode.time.steps;
    // piecewise: t sweeps the whole series, the engine mixes the two
    // neighbouring steps (uploaded once per segment, one uniform per frame)
    const seg = timeSegment(timeT, steps.length);
    const a = target.timeHeights?.get(steps[seg.i]!);
    const b = target.timeHeights?.get(steps[seg.i + 1]!);
    if (!a || !b) return;
    // A mode whose colour does not follow the steps (LAND: height is the
    // built share, colour the land cover) still has to hand the engine
    // colours. Without them it freezes whatever is on screen, which during
    // the entry morph is the flat state at alpha 0 — transparent columns.
    ctx.engine.scrub(
      a,
      b,
      seg.local,
      target.timeColors?.get(steps[seg.i]!) ?? target.colors,
      target.timeColors?.get(steps[seg.i + 1]!) ?? target.colors,
    );
    bumpSculpture();
  }, [ctx, ready, modeId, timeT, palette, focus, bumpSculpture]);

  // `shown` is what the sculpture on screen actually depicts: the current
  // mode once its scene is loaded, else the last mode this scene served.
  const shown = ctx !== null && scene !== undefined && datasetServesMode(scene.dataset, shownMode);
  const shownTarget = shown ? ctx.builder.build(shownMode, palette, focus) : null;

  return (
    <div
      className={`atlas${introOn ? ' atlas--intro' : ''}${
        sceneLoading ? ' atlas--loading' : ''
      }${aboutOpen ? ' atlas--about' : ''}`}
    >
      {ctx && scene && <SculptureView scene={scene} engine={ctx.engine} />}
      {scene && (
        <div className="topblock">
          <Wordmark />
          <Header mode={mode} scene={scene} />
        </div>
      )}
      {manifest && <ModeNav scene={scene} />}
      {ready && mode.time && <Timeline mode={mode} />}
      {shown && shownTarget && (
        <Legend mode={shownMode} scene={scene} colorStats={shownTarget.colorStats} />
      )}
      {shown && <Tooltip mode={shownMode} scene={scene} builder={ctx.builder} />}
      {ready && <Toolbar builder={ctx.builder} />}
      {ready && <StoryPlayer mode={mode} />}
      {/* neither needs the scene, and both must survive a dataset switch:
          the panel would lose the reader's place, and the legal links have
          to be reachable from every view, including the error screen */}
      <PageLinks />
      <AboutPanel />
      <Veil
        visible={status !== 'ready' || !scene}
        intro={introOn ? introPhase : null}
        error={error}
      />
    </div>
  );
}
