#!/usr/bin/env node
// Serves the built site the way the host will: with the rules from
// `_headers` actually applied.
//
// `vite preview` ignores `_headers`, so a Content-Security-Policy can only be
// wrong in production and nowhere else — the one place it cannot be caught by
// the checks. This closes that gap: build, serve with this, run `npm run ui`
// against it, and a policy that blocks a worker or a blob shows up as a
// failing check instead of a blank page after deploy.
//
//   npm run build && node scripts/serve-dist.mjs --port 4180
//   node scripts/check-ui.cjs --gpu --url http://localhost:4180
//
// It is a test harness, not a web server: no compression, no range requests.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const DIST = flag('--dist', join(ROOT, 'apps', 'web', 'dist'));
const PORT = Number(flag('--port', '4180'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** `_headers` as [pattern, {name: value}] pairs, in file order. */
function parseHeaders(file) {
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    const at = line.indexOf(':');
    if (at < 0 || !current) continue;
    current.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules;
}

const RULES = parseHeaders(join(DIST, '_headers'));

/** Cloudflare's rules are cumulative — every matching pattern contributes. */
function headersFor(urlPath) {
  const out = {};
  for (const { pattern, headers } of RULES) {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(urlPath)) Object.assign(out, headers);
  }
  // This harness speaks plain HTTP; the site it imitates speaks HTTPS.
  // `upgrade-insecure-requests` rewrites every same-origin subresource to
  // https://, which over http on a LAN address fails at the TLS handshake and
  // leaves a blank page — so dropping it here is closer to production, not
  // further from it. Same for the COOP header, which browsers ignore on an
  // origin that is not trustworthy and warn about in the console.
  if (out['Content-Security-Policy']) {
    out['Content-Security-Policy'] = out['Content-Security-Policy']
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && d !== 'upgrade-insecure-requests')
      .join('; ');
  }
  delete out['Cross-Origin-Opener-Policy'];
  return out;
}

/** Addresses another device on the same network can reach. */
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  // normalize first, then confirm the result is still under DIST
  let file = join(DIST, normalize(urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');

  let status = 200;
  if (!existsSync(file)) {
    // what a static host does with an unknown path
    file = join(DIST, '404.html');
    status = 404;
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
  }

  const head = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
  Object.assign(head, headersFor(urlPath));
  res.writeHead(status, head);
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`serving ${DIST} with ${RULES.length} header rule(s)`);
  console.log(`  http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`  http://${a}:${PORT}   (same network)`);
  console.log('  upgrade-insecure-requests and COOP are dropped: this harness is plain HTTP');
});
