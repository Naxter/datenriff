// What a visitor sees when the atlas cannot be drawn at all.
//
// Two failures land here: a browser without WebGL2, and a crash inside the
// renderer. Both used to end the same way — the veil lifted, the interface
// drew over empty paper, and the only explanation was a console message
// nobody reads. A blank page reads as "broken site", so say what happened,
// and keep the two pages a visitor is entitled to within reach.

import { Component, type ErrorInfo, type ReactNode } from 'react';

export function webgl2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

export function Unsupported({ reason, detail }: { reason: 'webgl' | 'crash'; detail?: string }) {
  const german = document.documentElement.lang === 'de';
  const text = german
    ? {
        title: 'Der Atlas kann hier nicht gezeichnet werden',
        webgl:
          'Diese Seite stellt Deutschland als dreidimensionale Skulptur dar und braucht dafür WebGL2. Ihr Browser stellt es nicht bereit — häufig, weil die Hardwarebeschleunigung ausgeschaltet ist oder der Grafiktreiber gesperrt wurde.',
        crash: 'Beim Zeichnen ist ein Fehler aufgetreten. Ein Neuladen hilft oft.',
        hint: 'Hardwarebeschleunigung in den Browsereinstellungen aktivieren, oder einen aktuellen Firefox, Chrome, Edge oder Safari verwenden.',
        reload: 'Neu laden',
        about: 'Über das Projekt',
      }
    : {
        title: 'The atlas cannot be drawn here',
        webgl:
          'This page renders Germany as a three-dimensional sculpture, which needs WebGL2. Your browser is not providing it — usually because hardware acceleration is switched off or the graphics driver is blocked.',
        crash: 'Something failed while drawing. Reloading often clears it.',
        hint: 'Enable hardware acceleration in your browser settings, or use a current Firefox, Chrome, Edge or Safari.',
        reload: 'Reload',
        about: 'About the project',
      };
  const aboutHref = german ? '/ueber/' : '/about/';

  return (
    <div className="unsupported">
      <div className="unsupported__sheet">
        <h1 className="unsupported__title">Datenriff</h1>
        <p className="unsupported__sub">Vertical Atlas — Germany</p>
        <h2 className="unsupported__head">{text.title}</h2>
        <p>{reason === 'webgl' ? text.webgl : text.crash}</p>
        {reason === 'webgl' && <p className="unsupported__hint">{text.hint}</p>}
        {detail && <p className="unsupported__detail">{detail}</p>}
        <p className="unsupported__links">
          <button type="button" onClick={() => window.location.reload()}>
            {text.reload}
          </button>
          <a href={aboutHref}>{text.about}</a>
          <a href="/impressum/">Impressum</a>
          <a href="/datenschutz/">Datenschutz</a>
        </p>
      </div>
    </div>
  );
}

/** Catches a render-time throw so it reports instead of blanking. */
export class RenderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; detail?: string }
> {
  override state = { failed: false, detail: undefined as string | undefined };

  static getDerivedStateFromError(error: Error) {
    return { failed: true, detail: error.message };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('atlas render failed:', error, info.componentStack);
  }

  override render() {
    if (this.state.failed) return <Unsupported reason="crash" detail={this.state.detail} />;
    return this.props.children;
  }
}
