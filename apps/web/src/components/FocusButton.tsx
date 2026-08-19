// FOCUS: pick a state or a city; the rest of the country steps back and
// the camera flies there. It sits with the mode families: both answer the
// question of what you are looking at.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneData } from '../data/loader';
import { cityFocus, focusCities, loadStates, stateFocus } from '../data/focusData';
import type { StatesFile } from '../sculpture/focus';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';

interface Props {
  scene: SceneData;
}

export function FocusButton({ scene }: Props) {
  const manifest = useAtlasStore((s) => s.manifest);
  const focus = useAtlasStore((s) => s.focus);
  const setFocus = useAtlasStore((s) => s.setFocus);
  const open = useAtlasStore((s) => s.focusOpen);
  const setOpen = useAtlasStore((s) => s.setFocusOpen);
  const [states, setStates] = useState<StatesFile | null>(null);
  const [query, setQuery] = useState('');
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);

  // outlines load on first open (300 KB nobody needs otherwise)
  useEffect(() => {
    if (!open || states || !manifest) return;
    void loadStates(manifest).then(setStates);
  }, [open, states, manifest]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // F toggles the picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        // opening focuses the search field, and without this the keypress
        // that opened it lands there as a literal "f"
        e.preventDefault();
        setOpen(!useAtlasStore.getState().focusOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const cities = useMemo(() => focusCities(scene), [scene]);
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const stateRows = (states?.states ?? []).filter((s) => match(s.name));
  const cityRows = cities.filter((c) => match(c.name));

  return (
    <div className="focus">
      <button
        type="button"
        className={`modenav__focus${focus ? ' modenav__focus--on' : ''}`}
        onClick={() => setOpen(!open)}
        title={t('focus.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {focus ? `${t('ui.focus')} · ${focus.name}` : t('ui.focus')}
      </button>
      {open && (
        <div className="focus__panel" role="dialog" aria-label={t('ui.focus')}>
          <input
            ref={input}
            className="focus__search"
            type="search"
            placeholder={t('focus.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('focus.search')}
          />
          <div className="focus__lists">
            <div className="focus__group">
              <p className="focus__heading">{t('focus.states')}</p>
              {!states && manifest?.states && (
                <p className="focus__note">{t('ui.loading')}</p>
              )}
              {!manifest?.states && (
                <p className="focus__note">No outlines — run scripts/fetch-states.mjs</p>
              )}
              {stateRows.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`focus__item${focus?.id === s.id ? ' focus__item--active' : ''}`}
                  onClick={() => {
                    setFocus(stateFocus(s));
                    setOpen(false);
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="focus__group">
              <p className="focus__heading">{t('focus.cities')}</p>
              {cityRows.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`focus__item${focus?.id === c.name ? ' focus__item--active' : ''}`}
                  onClick={() => {
                    setFocus(cityFocus(c));
                    setOpen(false);
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          {focus && (
            <button
              type="button"
              className="focus__clear"
              onClick={() => {
                setFocus(null);
                setOpen(false);
              }}
            >
              {t('focus.whole')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
