// About, read over the living atlas rather than instead of it.
//
// Each section owns a stop: scrolling it into view switches the mode behind
// the panel, so the prose about rainfall is read against the rainfall. The
// content is the same JSON the static /ueber/ page is generated from, loaded
// on first open so it costs nothing to the visitor who never asks for it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '../state/store';
import { INITIAL_VIEW_STATE } from '../sculpture/camera';
import { resolveReducedMotion } from '../state/settings';
import { useI18n } from '../i18n';

interface Stop {
  mode?: string;
  step?: number;
  /** A place to fly to, so a section about cells can show you cells. */
  camera?: {
    label: string;
    longitude: number;
    latitude: number;
    zoom: number;
    pitch?: number;
    bearing?: number;
  };
}

interface Section {
  id: string;
  heading: string;
  paragraphs: string[];
  stop?: Stop;
}

interface Doc {
  title: string;
  lead: string;
  sections: Section[];
}

/** Where a section without a camera sends the view: the country, as the
 *  atlas opens on it. Releasing the story instead would strand the reader
 *  at whatever close-up the previous section flew to. */
const COUNTRY_STOP = {
  label: 'Germany',
  longitude: INITIAL_VIEW_STATE.longitude!,
  latitude: INITIAL_VIEW_STATE.latitude!,
  zoom: INITIAL_VIEW_STATE.zoom!,
  pitch: INITIAL_VIEW_STATE.pitch,
  bearing: INITIAL_VIEW_STATE.bearing,
};

export function AboutPanel() {
  const open = useAtlasStore((s) => s.aboutOpen);
  const setOpen = useAtlasStore((s) => s.setAboutOpen);
  const setMode = useAtlasStore((s) => s.setMode);
  const setTimeT = useAtlasStore((s) => s.setTimeT);
  const playStory = useAtlasStore((s) => s.playStory);
  const settings = useAtlasStore((s) => s.settings);
  const reduceMotion = resolveReducedMotion(settings);
  const { lang, t } = useI18n();
  const [doc, setDoc] = useState<Doc | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    playStory(null);
    setOpen(false);
  }, [playStory, setOpen]);

  // A toggles it, like E and S; Escape closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape' && useAtlasStore.getState().aboutOpen) setOpen(false);
      if ((e.key === 'a' || e.key === 'A') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setOpen(!useAtlasStore.getState().aboutOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  // the prose is only fetched once somebody wants to read it
  useEffect(() => {
    if (!open || doc) return;
    let live = true;
    import('../content/pages.json')
      .then((m) => {
        const pages = (m.default ?? m) as { about: Record<string, Doc> };
        if (live) setDoc(pages.about[lang] ?? pages.about.en ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, doc, lang]);

  // switch language while it is open
  useEffect(() => {
    if (doc) setDoc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // the tour: whichever section is under the reading line owns the view
  useEffect(() => {
    if (!open || !doc || !scroller.current) return;
    const root = scroller.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const stop = doc.sections.find((s) => s.id === visible.target.id)?.stop;
        if (!stop) return;
        if (stop.mode && useAtlasStore.getState().modeId !== stop.mode) setMode(stop.mode);
        if (stop.step !== undefined) setTimeT(stop.step);
        // a camera stop rides the same flight the curated stories use; a
        // section without one flies back out to the country, so the reader
        // is never left reading about rainfall over a close-up of Berlin
        playStory(stop.camera ?? COUNTRY_STOP);
      },
      // a band across the middle of the panel, so a section takes over as it
      // reaches reading position rather than as it appears at the edge
      { root, rootMargin: '-40% 0px -45% 0px', threshold: [0, 0.5, 1] },
    );
    root.querySelectorAll('section[id]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [open, doc, setMode, setTimeT, playStory]);

  if (!open) return null;
  const moreHref = lang === 'de' ? '/ueber/' : '/about/';

  return (
    <aside
      className={`about${reduceMotion ? ' about--still' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={doc?.title ?? t('pages.about')}
    >
      <div className="about__bar">
        <span className="about__eyebrow">{t('pages.about')}</span>
        <button type="button" className="about__close" onClick={close} aria-label={t('ui.close')}>
          ×
        </button>
      </div>
      <div className="about__scroll" ref={scroller}>
        {doc ? (
          <>
            <h2 className="about__title">{doc.title}</h2>
            <p className="about__lead">{doc.lead}</p>
            {doc.sections.map((section) => (
              <section key={section.id} id={section.id} className="about__section">
                <h3>{section.heading}</h3>
                {section.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </section>
            ))}
            <p className="about__more">
              <a href={moreHref}>{t('pages.readAsPage')}</a>
            </p>
          </>
        ) : (
          <p className="about__lead">…</p>
        )}
      </div>
    </aside>
  );
}
