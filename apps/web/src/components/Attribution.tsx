import type { SceneData } from '../data/loader';

export function Attribution({ scene }: { scene: SceneData }) {
  const source = scene.dataset.source;
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
      <div>Datenriff · Vertical Atlas</div>
    </div>
  );
}
