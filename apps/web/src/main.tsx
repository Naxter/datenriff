import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { RenderBoundary, Unsupported, webgl2Available } from './app/Unsupported';
import { applyDocumentLang, detectLang } from './i18n';
import './design/global.css';

applyDocumentLang(detectLang());

// The sculpture is the product, so a browser that cannot draw it is told so
// rather than shown an interface over blank paper.
const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {webgl2Available() ? (
      <RenderBoundary>
        <App />
      </RenderBoundary>
    ) : (
      <Unsupported reason="webgl" />
    )}
  </StrictMode>,
);
