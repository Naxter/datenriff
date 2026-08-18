import type { SceneData } from '../data/loader';
import { useAtlasStore } from '../state/store';

/** Always visible: the data credit is a licence condition. While a state is
 *  in focus its outline source (BKG, DL-DE-BY-2.0) is credited as well. */
export function Attribution({ scene }: { scene: SceneData }) {
  const source = scene.dataset.source;
  const focus = useAtlasStore((s) => s.focus);
  return (
    <div className="attribution">
      <div>
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        ) : (
          source.label
        )}
      </div>
      {focus?.kind === 'state' && <div>Boundaries: © GeoBasis-DE / BKG · DL-DE-BY-2.0</div>}
      <div>Datenriff · Vertical Atlas</div>
    </div>
  );
}
