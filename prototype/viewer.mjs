// Dependency-free WebGL2 viewer for the binary sculpture buffers:
// instanced hex prisms, flat shading, isometric telephoto camera, paper
// canvas. Serves as the renderer testbed without any toolchain — run
// `npx http-server` from the repo root and open /prototype/.
// The product renderer is apps/web; keep camera/light values in sync.
//
// Tuning via query params: ?h= ?frame= ?pitch= ?bearing= ?tx= ?ty= ?palette=
//   ?base= (plinth depth in metres, 0 disables the island look)

const QUERY = new URLSearchParams(location.search);
const TARGET_MAX_HEIGHT = Number(QUERY.get('h') ?? 100_000);
// every cell also extends downwards, so the country reads as one slab
const BASE_DEPTH = Number(QUERY.get('base') ?? 18_000);
// column silhouette: 1 = straight bar, 0 = needle tapering to a point.
// Only the part above ground tapers; the plinth stays a solid slab.
const TAPER = Number(QUERY.get('taper') ?? 1);
// column thickness multiplier, for thinner needles
const THIN = Number(QUERY.get('thin') ?? 1);
const FRAME_HEIGHT_M = Number(QUERY.get('frame') ?? 1_250_000);
const FOVY_DEG = 24;
let pitchDeg = Number(QUERY.get('pitch') ?? 58);
let bearingDeg = Number(QUERY.get('bearing') ?? -18);
let frameHeight = FRAME_HEIGHT_M;
const TX = Number(QUERY.get('tx') ?? 100_000);
const TY = Number(QUERY.get('ty') ?? 150_000);
const SHADOWS = QUERY.get('shadow') !== '0';
const SHADOW_MAP_SIZE = 2048;

const PAPER = [247 / 255, 240 / 255, 234 / 255];

// keep in sync with packages/color-scales
const RAMPS = {
  population: ['#ECE7F6', '#C9B6E9', '#A280D8', '#8F5FBF', '#B2519F', '#C41E78'],
  glacier: ['#EBF0F4', '#C3D4E2', '#8FB0CE', '#5E7FB3', '#3D5490', '#22336B'],
  ember: ['#F5EDE0', '#EFD08A', '#E8A24C', '#D66233', '#A82E2C', '#6E1420'],
  noir: ['#EEE8E0', '#CFC8BE', '#A39B8F', '#6F675C', '#403A32', '#191511'],
  age: ['#2F8A7D', '#9EC6B6', '#F2EBDF', '#C98FA8', '#77365C'],
  rent: ['#F2EBDF', '#EFC968', '#E89A3C', '#D95F3B', '#A8232F'],
};
const RAMP = (RAMPS[QUERY.get('palette')] ?? RAMPS.population).map(hexToRgb);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

const dataUrl = (p) => new URL(`../apps/web/public${p}`, import.meta.url);

async function loadData() {
  const manifest = await (await fetch(dataUrl('/data/manifest.json'))).json();
  const dataset = manifest.datasets[0];
  // coarsest un-tiled LOD; finer LODs ship as viewport tiles the app streams
  const lod = [...dataset.lods]
    .filter((l) => l.positions && l.metricTemplate)
    .sort((a, b) => a.resolution - b.resolution)[0];
  const positions = new Float32Array(
    await (await fetch(dataUrl(lod.positions))).arrayBuffer(),
  );
  const metricDef = dataset.metrics.find((m) => m.id === 'population_2022');
  const values = new Float32Array(
    await (await fetch(dataUrl(lod.metricTemplate.replace('{metric}', 'population_2022.f32')))).arrayBuffer(),
  );
  return { lod, metricDef, positions, values };
}

// minimal column-major matrix math
function perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

function lookAt(eye, target, up) {
  const f = norm(sub(target, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  return [
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return out;
}

// unit hex prism: [ux, uy, uz, nx, ny, nz] per vertex, uz scales with height
function buildPrism() {
  const verts = [];
  const corner = (k) => {
    const a = (k % 6) * (Math.PI / 3);
    return [Math.cos(a), Math.sin(a)];
  };
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = corner(k);
    const [bx, by] = corner(k + 1);
    const na = (k + 0.5) * (Math.PI / 3);
    const n = [Math.cos(na), Math.sin(na), 0];
    verts.push(
      ax, ay, 0, ...n, bx, by, 0, ...n, bx, by, 1, ...n,
      ax, ay, 0, ...n, bx, by, 1, ...n, ax, ay, 1, ...n,
    );
  }
  const up = [0, 0, 1];
  for (let k = 1; k < 5; k++) {
    const [ax, ay] = corner(0);
    const [bx, by] = corner(k);
    const [cx, cy] = corner(k + 1);
    verts.push(ax, ay, 1, ...up, bx, by, 1, ...up, cx, cy, 1, ...up);
  }
  return new Float32Array(verts);
}

const VS = `#version 300 es
layout(location=0) in vec3 unitPos;
layout(location=1) in vec3 normal;
layout(location=2) in vec2 iCenter;
layout(location=3) in float iHeight;
layout(location=4) in vec4 iColor;
uniform mat4 uVP;
uniform mat4 uLightVP;
uniform float uRadius;
uniform float uBase;
uniform float uTaper;
out vec3 vNormal;
out vec4 vColor;
out vec4 vShadowCoord;
out float vWorldZ;
out float vHeight;
void main() {
  // columns start at -uBase, so the whole country carries a plinth
  float z = mix(-uBase, iHeight, unitPos.z);
  // taper only above the ground line, so the plinth keeps its full width
  float up = iHeight > 1.0 ? clamp(z / iHeight, 0.0, 1.0) : 0.0;
  float widthScale = mix(1.0, uTaper, up);
  vec3 p = vec3(iCenter + unitPos.xy * uRadius * widthScale, z);
  vNormal = normal;
  vColor = iColor;
  // world z interpolates linearly, so the ground line stays exact on the walls
  vWorldZ = z;
  vHeight = iHeight;
  vShadowCoord = uLightVP * vec4(p, 1.0);
  gl_Position = uVP * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec4 vColor;
in vec4 vShadowCoord;
in float vWorldZ;
in float vHeight;
uniform float uBase;
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform sampler2D uShadowMap;
uniform float uShadowsOn;
out vec4 frag;

float shadowFactor(vec3 n) {
  if (uShadowsOn < 0.5) return 1.0;
  vec3 sc = vShadowCoord.xyz / vShadowCoord.w * 0.5 + 0.5;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float bias = max(0.0035 * (1.0 - dot(n, -uKeyDir)), 0.0012);
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float lit = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      float d = texture(uShadowMap, sc.xy + vec2(dx, dy) * texel * 2.0).r;
      lit += (sc.z - bias > d) ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, -uKeyDir), 0.0);
  float fill = max(dot(n, -uFillDir), 0.0);
  float shadow = shadowFactor(n);
  // sides darken slightly towards the top of the column's own base
  float up = vHeight > 1.0 ? clamp(vWorldZ / vHeight, 0.0, 1.0) : 1.0;
  float sideShade = n.z > 0.5 ? 1.0 : mix(0.86, 1.0, clamp(up * 1.3, 0.0, 1.0));
  // plinth reads as rock: desaturated, darkening with depth below the ground line
  float below = uBase > 0.0 ? clamp(-vWorldZ / uBase, 0.0, 1.0) : 0.0;
  float grey = dot(vColor.rgb, vec3(0.34, 0.42, 0.24));
  vec3 rock = mix(vColor.rgb, mix(vec3(grey), vec3(0.62, 0.55, 0.47), 0.72), 0.85);
  vec3 albedo = mix(vColor.rgb, rock * mix(1.0, 0.66, below), smoothstep(0.0, 0.02, below));
  vec3 lit = albedo * sideShade *
    (0.64 * mix(0.94, 1.0, shadow)
     + 0.48 * key * mix(0.42, 1.0, shadow) * vec3(1.00, 0.95, 0.88)
     + 0.22 * fill * vec3(0.73, 0.79, 1.00));
  frag = vec4(min(lit, vec3(1.0)), vColor.a);
}`;

const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 unitPos;
layout(location=2) in vec2 iCenter;
layout(location=3) in float iHeight;
uniform mat4 uLightVP;
uniform float uRadius;
uniform float uBase;
uniform float uTaper;
void main() {
  float z = mix(-uBase, iHeight, unitPos.z);
  float up = iHeight > 1.0 ? clamp(z / iHeight, 0.0, 1.0) : 0.0;
  vec3 p = vec3(iCenter + unitPos.xy * uRadius * mix(1.0, uTaper, up), z);
  gl_Position = uLightVP * vec4(p, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

function ortho(hw, hh, near, far) {
  return [
    1 / hw, 0, 0, 0,
    0, 1 / hh, 0, 0,
    0, 0, -2 / (far - near), 0,
    0, 0, -(far + near) / (far - near), 1,
  ];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
  }
  return sh;
}

async function main() {
  const { lod, metricDef, positions, values } = await loadData();
  const n = values.length;

  // local metre coordinates around the dataset centre
  const [w, s, e, nn] = lod.bounds;
  const lon0 = (w + e) / 2;
  const lat0 = (s + nn) / 2;
  const mPerDegLat = 111_132;
  const centers = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const lon = positions[i * 2];
    const lat = positions[i * 2 + 1];
    const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
    centers[i * 2] = (lon - lon0) * mPerDegLon;
    centers[i * 2 + 1] = (lat - lat0) * mPerDegLat;
  }

  // linear heights calibrated at p99.5
  const p995 = metricDef.stats.p995;
  const hScale = TARGET_MAX_HEIGHT / p995;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = values[i] * hScale;

  // sqrt colour scale clipped at p99.5
  const colors = new Uint8Array(n * 4);
  const span = Math.sqrt(p995);
  const gamma = Number(QUERY.get('gamma') ?? 1.5);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(Math.min(1, Math.sqrt(Math.max(0, values[i])) / span), gamma);
    const x = t * (RAMP.length - 1);
    const k = Math.min(Math.floor(x), RAMP.length - 2);
    const f = x - k;
    const o = i * 4;
    colors[o] = 255 * (RAMP[k][0] + (RAMP[k + 1][0] - RAMP[k][0]) * f);
    colors[o + 1] = 255 * (RAMP[k][1] + (RAMP[k + 1][1] - RAMP[k][1]) * f);
    colors[o + 2] = 255 * (RAMP[k][2] + (RAMP[k + 1][2] - RAMP[k][2]) * f);
    colors[o + 3] = 255;
  }

  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 not available');

  const makeProgram = (vsSrc, fsSrc) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    }
    return prog;
  };
  const mainProg = makeProgram(VS, FS);
  const depthProg = makeProgram(DEPTH_VS, DEPTH_FS);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const mesh = buildPrism();
  const meshBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

  const instance = (loc, data, size, type, normalized) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
  };
  instance(2, centers, 2, gl.FLOAT, false);
  instance(3, heights, 1, gl.FLOAT, false);
  instance(4, colors, 4, gl.UNSIGNED_BYTE, true);

  const radius = lod.cellRadiusMeters * 1.15 * THIN;
  const keyDir = norm([-3, -5, -4.2]);
  const fillDir = norm([4, 2, -1.2]);

  // directional-light depth map over the whole scene
  let maxHeight = 0;
  for (let i = 0; i < n; i++) if (heights[i] > maxHeight) maxHeight = heights[i];
  const sceneRadius = 520_000;
  const lightDist = 2_200_000;
  const lightTarget = [0, 0, maxHeight * 0.25];
  const lightEye = [
    lightTarget[0] - keyDir[0] * lightDist,
    lightTarget[1] - keyDir[1] * lightDist,
    lightTarget[2] - keyDir[2] * lightDist,
  ];
  const lightVP = multiply(
    ortho(sceneRadius * 1.6, sceneRadius * 1.6, lightDist * 0.2, lightDist * 2.2),
    lookAt(lightEye, lightTarget, [0, 0, 1]),
  );

  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const loc = (prog, name) => gl.getUniformLocation(prog, name);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  let shadowMapReady = false;
  function renderShadowMap() {
    gl.useProgram(depthProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc(depthProg, 'uLightVP'), false, new Float32Array(lightVP));
    gl.uniform1f(loc(depthProg, 'uRadius'), radius);
    gl.uniform1f(loc(depthProg, 'uBase'), BASE_DEPTH);
    gl.uniform1f(loc(depthProg, 'uTaper'), TAPER);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 48, n);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadowMapReady = true;
  }

  function drawScene(width, height) {
    // geometry is static, so the depth map only needs one render
    if (SHADOWS && !shadowMapReady) renderShadowMap();

    gl.useProgram(mainProg);
    gl.viewport(0, 0, width, height);
    gl.clearColor(...PAPER, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const fovy = (FOVY_DEG * Math.PI) / 180;
    const dist = frameHeight / 2 / Math.tan(fovy / 2);
    const pitch = (pitchDeg * Math.PI) / 180;
    const bearing = (bearingDeg * Math.PI) / 180;
    // offset south of the target, lifted by pitch, swung by bearing
    const off = [0, -Math.sin(pitch) * dist, Math.cos(pitch) * dist];
    const target = [TX, TY, 0];
    const eye = [
      target[0] + off[0] * Math.cos(bearing) - off[1] * Math.sin(bearing),
      target[1] + off[0] * Math.sin(bearing) + off[1] * Math.cos(bearing),
      off[2],
    ];
    const view = lookAt(eye, target, [0, 0, 1]);
    const proj = perspective(fovy, width / height, dist / 50, dist * 5);
    gl.uniformMatrix4fv(loc(mainProg, 'uVP'), false, new Float32Array(multiply(proj, view)));
    gl.uniformMatrix4fv(loc(mainProg, 'uLightVP'), false, new Float32Array(lightVP));
    gl.uniform1f(loc(mainProg, 'uRadius'), radius);
    gl.uniform1f(loc(mainProg, 'uBase'), BASE_DEPTH);
    gl.uniform1f(loc(mainProg, 'uTaper'), TAPER);
    gl.uniform3fv(loc(mainProg, 'uKeyDir'), keyDir);
    gl.uniform3fv(loc(mainProg, 'uFillDir'), fillDir);
    gl.uniform1f(loc(mainProg, 'uShadowsOn'), SHADOWS ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(loc(mainProg, 'uShadowMap'), 0);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 48, n);
    gl.flush();
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    drawScene(canvas.width, canvas.height);
    window.__RENDERED = true;
  }

  // poster export: press E for a 4K PNG of the bare sculpture
  function exportPoster() {
    canvas.width = 3840;
    canvas.height = 2400;
    drawScene(canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vertical-atlas.png';
      a.click();
      URL.revokeObjectURL(a.href);
      draw();
    }, 'image/png');
  }

  draw();
  window.addEventListener('resize', draw);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E') exportPoster();
  });
  let dragging = false;
  let last = [0, 0];
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    last = [e.clientX, e.clientY];
  });
  window.addEventListener('mouseup', () => (dragging = false));
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    bearingDeg += (e.clientX - last[0]) * 0.25;
    pitchDeg = Math.min(75, Math.max(10, pitchDeg + (e.clientY - last[1]) * 0.2));
    last = [e.clientX, e.clientY];
    draw();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    frameHeight = Math.min(4_000_000, Math.max(150_000, frameHeight * Math.exp(e.deltaY * 0.001)));
    draw();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:absolute;left:48px;bottom:40px;color:#a8232f">${String(err)}</pre>`,
  );
});
