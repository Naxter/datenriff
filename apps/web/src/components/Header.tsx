import type { SculptureMode } from '@datenriff/data-contracts';

export function Header({ mode }: { mode: SculptureMode }) {
  const date = mode.attribution.referenceDate
    ? new Date(mode.attribution.referenceDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : undefined;
  return (
    <header className="header">
      <p className="header__kicker">Vertical Atlas — Germany</p>
      <h1 className="header__title">{mode.label}</h1>
      <p className="header__subtitle">{mode.subtitle}</p>
      {date && <p className="header__date">{date}</p>}
    </header>
  );
}
