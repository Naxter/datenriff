#!/usr/bin/env node
// Render the standing pages — about, Impressum, Datenschutz — as plain HTML.
//
// They are deliberately not part of the single-page app. A legal notice has
// to be reachable when WebGL is blocked, when the bundle fails, when
// JavaScript is off entirely; and a crawler should be able to read the
// explanations without executing an application. So these are files: a few
// kilobytes each, no script tag, sharing only the fonts with the atlas.
//
// The prose lives once, in apps/web/src/content/pages.json, and is also what
// the in-app About panel shows. Edit there, then re-run this.
//
//   node scripts/build-pages.mjs

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'apps', 'web', 'public');
const CONTENT = join(ROOT, 'apps', 'web', 'src', 'content', 'pages.json');
// The canonical host, baked into the standing pages, the sitemap, robots.txt
// and the atlas page's head. It has to be the *default* rather than something
// passed at deploy time: `npm run build` runs this script, so a default that
// disagreed with what is committed would quietly rewrite every canonical back
// on the next build — and CI, which builds and then checks `git diff`, would
// fail. SITE_URL overrides it for trying another host.
const SITE = process.env.SITE_URL ?? 'https://datenriff.de';

/** Which document goes where, and how the languages pair up for hreflang. */
const PAGES = [
  { key: 'about', lang: 'de', path: 'ueber', alt: { en: 'about' } },
  { key: 'about', lang: 'en', path: 'about', alt: { de: 'ueber' } },
  { key: 'impressum', lang: 'de', path: 'impressum' },
  { key: 'datenschutz', lang: 'de', path: 'datenschutz' },
];

const NAV = {
  de: { atlas: 'Zum Atlas', ueber: 'Über', impressum: 'Impressum', datenschutz: 'Datenschutz' },
  en: { atlas: 'To the atlas', ueber: 'About', impressum: 'Legal notice', datenschutz: 'Privacy' },
};

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** First paragraph, trimmed to something a search result can show. */
function metaDescription(doc) {
  const text = doc.lead ?? doc.sections[0]?.paragraphs[0] ?? '';
  return text.length > 155 ? `${text.slice(0, 152).replace(/[\s,.;:]+\S*$/, '')}…` : text;
}

const STYLE = `
  :root {
    --paper: #f7f0ea; --ink: #221c15; --soft: rgba(34,28,21,0.66);
    --faint: rgba(34,28,21,0.14); --accent: #c41e78;
    --serif: 'Instrument Serif', 'Iowan Old Style', Georgia, serif;
    --sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #17130f; --ink: #efe7dd; --soft: rgba(239,231,221,0.66);
            --faint: rgba(239,231,221,0.16); --accent: #ef7fb4; }
  }
  * { box-sizing: border-box; }
  body { background: var(--paper); color: var(--ink); font-family: var(--sans);
         font-size: 16px; line-height: 1.65; margin: 0; padding: 3rem 1.4rem 5rem;
         -webkit-font-smoothing: antialiased; }
  main { max-width: 44rem; margin: 0 auto; }
  nav { display: flex; flex-wrap: wrap; gap: 1.2rem; font-size: 0.8rem;
        letter-spacing: 0.14em; text-transform: uppercase;
        padding-bottom: 2.2rem; border-bottom: 1px solid var(--faint); }
  nav a { color: var(--soft); text-decoration: none; }
  nav a:hover, nav a:focus-visible { color: var(--ink); }
  nav a[aria-current] { color: var(--ink); }
  h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(2.2rem, 6vw, 3.2rem);
       line-height: 1.06; margin: 2.6rem 0 1.2rem; }
  h2 { font-family: var(--serif); font-weight: 400; font-size: 1.7rem;
       margin: 2.8rem 0 0.6rem; }
  p { margin: 0 0 1rem; }
  .lead { font-size: 1.08rem; color: var(--soft); margin-bottom: 2.2rem; }
  .placeholder { border-left: 2px solid var(--accent); padding-left: 1rem;
                 color: var(--soft); font-size: 0.95rem; }
  footer { margin-top: 4rem; padding-top: 1.4rem; border-top: 1px solid var(--faint);
           font-size: 0.85rem; color: var(--soft); }
  footer a { color: inherit; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
`;

function render({ key, lang, path, alt, noindex }, content) {
  const doc = content[key][lang];
  const nav = NAV[lang];
  const links = [
    ['/', nav.atlas],
    [lang === 'de' ? '/ueber/' : '/about/', nav.ueber],
    ['/impressum/', nav.impressum],
    ['/datenschutz/', nav.datenschutz],
  ];
  const here = `/${path}/`;

  const body = doc.sections
    .map((section) => {
      const isNote = section.paragraphs.some((p) => p.startsWith('PLATZHALTER'));
      const paras = section.paragraphs
        .map((p) => `      <p${isNote ? ' class="placeholder"' : ''}>${escape(p)}</p>`)
        .join('\n');
      return `    <section id="${section.id}">\n      <h2>${escape(section.heading)}</h2>\n${paras}\n    </section>`;
    })
    .join('\n\n');

  const hreflang = alt
    ? Object.entries(alt)
        .map(
          ([otherLang, otherPath]) =>
            `    <link rel="alternate" hreflang="${otherLang}" href="${SITE}/${otherPath}/" />`,
        )
        .join('\n') + `\n    <link rel="alternate" hreflang="${lang}" href="${SITE}${here}" />`
    : '';

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escape(doc.title.includes('Datenriff') ? doc.title : `${doc.title} — Datenriff`)}</title>
    <meta name="description" content="${escape(metaDescription(doc))}" />
${noindex ? '    <meta name="robots" content="noindex" />' : `    <link rel="canonical" href="${SITE}${here}" />`}
${hreflang}
    <link rel="stylesheet" href="/fonts.css" />
    <style>${STYLE}</style>
  </head>
  <body>
    <main>
      <nav>
${links
  .map(
    ([href, label]) =>
      `        <a href="${href}"${href === here ? ' aria-current="page"' : ''}>${escape(label)}</a>`,
  )
  .join('\n')}
      </nav>
      <h1>${escape(doc.title)}</h1>
      ${doc.lead ? `<p class="lead">${escape(doc.lead)}</p>` : ''}

${body}

      <footer>
        <p>Datenriff — ${lang === 'de' ? 'Vertikaler Atlas Deutschland' : 'Vertical Atlas Germany'} · <a href="/">${escape(nav.atlas)}</a></p>
      </footer>
    </main>
  </body>
</html>
`;
}

async function main() {
  const content = JSON.parse(await readFile(CONTENT, 'utf8'));

  // the static pages need the faces too, without importing the app's CSS
  const fontsCss = await readFile(join(ROOT, 'apps', 'web', 'src', 'design', 'fonts.css'), 'utf8');
  await writeFile(join(PUBLIC, 'fonts.css'), fontsCss, 'utf8');

  for (const page of PAGES) {
    const dir = join(PUBLIC, page.path);
    await mkdir(dir, { recursive: true });
    const html = render(page, content);
    await writeFile(join(dir, 'index.html'), html, 'utf8');
    console.log(`  /${page.path}/  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB  [${page.lang}]`);
  }

  // The atlas page carries the same host in its canonical link and its Open
  // Graph tags. It is a Vite entry rather than a generated file, so it is
  // patched here instead of written: one SITE_URL, one place to change, and
  // no way to publish standing pages that disagree with the app about where
  // the site lives.
  const appHtmlPath = join(ROOT, 'apps', 'web', 'index.html');
  const appHtml = await readFile(appHtmlPath, 'utf8');
  const patched = appHtml.replace(
    /(<link rel="canonical" href="|<meta property="og:url" content="|<meta property="og:image" content=")https?:\/\/[^"/]+/g,
    (_, tag) => `${tag}${SITE}`,
  );
  if (patched !== appHtml) {
    await writeFile(appHtmlPath, patched, 'utf8');
    console.log(`  apps/web/index.html  canonical and og tags → ${SITE}`);
  }

  // A real 404, so an unknown path says so instead of quietly serving the
  // atlas. A soft 404 tells a crawler the page exists and tells a reader
  // their link worked; neither is true.
  const notFound = render(
    { key: '__404', lang: 'de', path: '404', noindex: true },
    {
      __404: {
        de: {
          title: 'Seite nicht gefunden',
          lead: 'Diese Adresse gibt es hier nicht — vielleicht ein alter Link, vielleicht ein Tippfehler.',
          sections: [
            {
              id: 'weiter',
              heading: 'Weiter',
              paragraphs: [
                'Zum <a href="/">Atlas</a>, zu <a href="/ueber/">Über das Projekt</a>, zum <a href="/impressum/">Impressum</a> oder zur <a href="/datenschutz/">Datenschutzerklärung</a>.',
              ],
            },
          ],
        },
      },
    },
  );
  await writeFile(join(PUBLIC, '404.html'), notFound, 'utf8');
  console.log(`  404.html  ${(Buffer.byteLength(notFound) / 1024).toFixed(1)} kB`);

  const urls = PAGES.map((p) => `${SITE}/${p.path}/`);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [`${SITE}/`, ...urls]
      .map((loc) => `  <url><loc>${loc}</loc></url>`)
      .join('\n') +
    `\n</urlset>\n`;
  await writeFile(join(PUBLIC, 'sitemap.xml'), sitemap, 'utf8');
  await writeFile(
    join(PUBLIC, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    'utf8',
  );
  console.log(`  sitemap.xml, robots.txt`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
