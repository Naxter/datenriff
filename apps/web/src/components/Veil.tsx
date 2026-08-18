export function Veil({ visible, error }: { visible: boolean; error?: string }) {
  return (
    <div className={`veil${visible ? '' : ' veil--hidden'}`} aria-hidden={!visible}>
      <div className="veil__mark">
        <h1 className="veil__title">Vertical Atlas</h1>
        <p className="veil__sub">Germany</p>
        {error && <p className="veil__error">{error}</p>}
      </div>
    </div>
  );
}
