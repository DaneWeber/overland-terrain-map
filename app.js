/* Overland Terrain Map — a D&D 3.5e overland map editor for printing on Letter paper.
 * Plain browser JavaScript, no build step. All drawing is SVG so it prints crisply.
 *
 * Geometry is in "cell units": a square is 1 x 1, a hex is 1 unit flat-to-flat
 * (pointy-top hexes, odd rows shifted right). The editor and the printer render
 * the same SVG content at different scales.
 */
'use strict';
(function () {

// ---------------------------------------------------------------- constants
// mv = PHB Table 9-5 overland movement multipliers: [highway, road or trail, trackless]
const TERRAINS = [
  { id: 'desert',    name: 'Desert',    abbr: 'De', color: '#f2dc9b', mv: [1, 1/2, 1/2] },
  { id: 'forest',    name: 'Forest',    abbr: 'Fo', color: '#9fd49a', mv: [1, 1, 1/2] },
  { id: 'hills',     name: 'Hills',     abbr: 'Hi', color: '#d9c08e', mv: [1, 3/4, 1/2] },
  { id: 'jungle',    name: 'Jungle',    abbr: 'Ju', color: '#5fbf8f', mv: [1, 3/4, 1/4] },
  { id: 'moor',      name: 'Moor',      abbr: 'Mo', color: '#cdb7dc', mv: [1, 1, 3/4] },
  { id: 'mountains', name: 'Mountains', abbr: 'Mt', color: '#b5aca2', mv: [3/4, 3/4, 1/2] },
  { id: 'plains',    name: 'Plains',    abbr: 'Pl', color: '#e9f2b6', mv: [1, 1, 3/4] },
  { id: 'swamp',     name: 'Swamp',     abbr: 'Sw', color: '#9cc6c0', mv: [1, 3/4, 1/2] },
  { id: 'tundra',    name: 'Tundra',    abbr: 'Tu', color: '#e1ecf7', mv: [1, 3/4, 3/4] },
];
const TMAP = Object.fromEntries(TERRAINS.map(t => [t.id, t]));
const ROADS = [
  { id: 'highway', name: 'Highway' },
  { id: 'trail',   name: 'Road / Trail' },
  { id: 'none',    name: 'Trackless' },
];
const ROAD_NAME = { highway: 'Highway', trail: 'Road / Trail' };

const TOOL_HINTS = {
  terrain: 'Click or drag to paint the selected terrain. Right-drag clears terrain.',
  fill: 'Click to fill a connected area of the same terrain (an empty map fills completely).',
  road: 'Drag from cell to cell to lay a road; it follows your path. Click a road cell to change its type. Right-drag (or pick Trackless) removes road.',
  erase: 'Click or drag to clear everything in a cell (terrain, road, river, cliff).',
  'river-cell': 'Drag from cell to cell to run a river through them; drag off the map edge to have it flow off. Right-drag removes.',
  'river-edge': 'Drag along cell borders to draw a river on the borders.',
  'cliff-cell': 'Click a cell to mark that it contains a cliff.',
  'cliff-edge': 'Drag along cell borders with the pointer on the LOW side. Shift+click a cliff to flip it.',
};
const EDGE_TOOLS = { 'river-edge': 'river', 'cliff-edge': 'cliff' };
const BRUSH_TOOLS = new Set(['terrain', 'erase']);
const LINK_TOOLS = { road: 'road', 'river-cell': 'river' };   // tool -> cell property
const LINK_SETS = { road: 'roadLinks', river: 'riverLinks' };  // cell property -> state key

const S3 = Math.sqrt(3), HS = 1 / S3, VSTEP = 1.5 * HS;
const HEX_C = [[S3/2, -0.5], [S3/2, 0.5], [0, 1], [-S3/2, 0.5], [-S3/2, -0.5], [0, -1]];
// edge i runs from corner i to corner i+1: E, SE, SW, W, NW, NE
const HEX_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const HEX_ODD  = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
const SQ_C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const SQ_N = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W

const PAD = 0.2;         // cell units of white space around the map
const PX = 48;           // screen pixels per cell unit at 100% zoom
const INK = '#151515';
const RIVER = '#1b5fb5';
const GRID = '#4a4a4a';
const FONT = 'Arial, Helvetica, sans-serif';
const STORE_KEY = 'overland-terrain-map:v1';
const MAX_CELLS = 40000;

const f = n => Math.round(n * 1000) / 1000;
const key = (c, r) => c + ',' + r;
const parseKey = k => k.split(',').map(Number);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const $ = sel => document.querySelector(sel);

function frac(v) {
  const m = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1: '1' };
  return '×' + (m[v] || v);
}
function fmtNum(v) {
  const fr = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  const whole = Math.floor(v + 1e-9), rest = Math.round((v - whole) * 100) / 100;
  if (fr[rest] !== undefined) return (whole ? whole : '') + fr[rest];
  return String(Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------- terrain icons
// Drawn in a -10..10 box. Strokes inherit color/width from the <use> element so they scale cleanly.
const LIGHT = 'fill="#fff" fill-opacity="0.8"';
const tuft = (x, y, k) => `M${x},${y}l${f(-1.5*k)},${f(-3*k)}M${x},${y}v${f(-3.6*k)}M${x},${y}l${f(1.5*k)},${f(-3*k)}`;
const dots = (arr, r) => arr.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
const palm = (bx, by, tx, ty, s) =>
  `M${bx},${by}Q${bx + 2*s},${(by + ty) / 2} ${tx},${ty}` +
  `M${tx},${ty}q${-5*s},${-4.5*s} ${-8*s},${1.5*s}` +
  `M${tx},${ty}q${-3*s},${-6*s} ${-6.5*s},${-5.5*s}` +
  `M${tx},${ty}q${3*s},${-6*s} ${6.5*s},${-5.5*s}` +
  `M${tx},${ty}q${5*s},${-4.5*s} ${8*s},${1.5*s}`;
const flake = (x, y, r) => [90, 30, 150].map(a => {
  const dx = r * Math.cos(a * Math.PI / 180), dy = r * Math.sin(a * Math.PI / 180);
  return `M${f(x - dx)},${f(y - dy)}L${f(x + dx)},${f(y + dy)}`;
}).join('');

const SYMBOLS = {
  desert:
    `<path d="M-9,0.5Q-4.5,-4.5 0,0.5M-1,7.5Q3.5,2.5 8,7.5"/>` +
    `<g fill="currentColor" stroke="none">${dots([[-6, -6.5], [1.5, -7.5], [7, -3.5], [-3.5, 4.5], [3.5, -1.5], [-8, 7], [-1, -3.5]], 1)}</g>`,
  forest:
    `<path d="M5,8.5V3"/><circle cx="5" cy="-1" r="4.2" ${LIGHT}/>` +
    `<path d="M-3.5,8.5V2"/><circle cx="-3.5" cy="-3" r="5.2" ${LIGHT}/>`,
  hills:
    `<path d="M-1,6Q4,-4 9.5,6" ${LIGHT}/><path d="M-9.5,2Q-4,-11 1.5,2" ${LIGHT}/>` +
    `<path d="M-2.2,-2.6l1.4,1.8M-0.8,-0.6l1.3,1.7M5.6,1.6l1.2,1.6"/>`,
  jungle:
    `<path d="${palm(-2, 9, -2.5, -3, 1)}${palm(6.5, 9, 6, 3, 0.6)}"/>`,
  moor:
    `<path d="M-9.5,5Q-5,1.5 -0.5,5M0.5,0Q5,-3.5 9.5,0"/>` +
    `<path d="${tuft(-5, 3.3, 1.3)}${tuft(5, -1.7, 1.3)}${tuft(1, 9, 0.9)}"/>` +
    `<g fill="currentColor" stroke="none">${dots([[-7, -0.6], [-5, -1.4], [-3, -0.6], [3, -5.6], [5, -6.4], [7, -5.6]], 1.05)}</g>`,
  mountains:
    `<path d="M1,8L5.5,-1L10,8" ${LIGHT}/>` +
    `<path d="M-9.5,8L-2,-8.5L5.5,8Z" ${LIGHT}/>` +
    `<path d="M-2,-8.5L0.5,8L5.5,8Z" fill="currentColor" fill-opacity="0.35" stroke="none"/>` +
    `<path d="M-4.9,-2l1.5,1.2l1.5,-1.2l1.4,1.2l1.5,-1.2"/>`,
  plains:
    `<path d="${tuft(-5, -1, 0.8)}${tuft(4.5, -3.5, 0.8)}${tuft(0, 6, 0.8)}${tuft(7, 6.5, 0.6)}${tuft(-7, 7.5, 0.6)}"/>` +
    `<path d="M-7,-1h4M2.5,-3.5h4M-2,6h4"/>`,
  swamp:
    `<path d="M-9.5,4h5M-2,4h4.5M5,4h4.5M-7,7.5h5M0.5,7.5h6"/>` +
    `<path d="M-4.5,4V-3.5M-1.5,4V-6M1.5,4V-2.5M-1.5,2Q-6,-1 -8,-2M1.5,2Q5,0 7,-1"/>` +
    `<g fill="currentColor" stroke="none"><ellipse cx="-4.5" cy="-4" rx="1" ry="2.2"/><ellipse cx="-1.5" cy="-6.5" rx="1" ry="2.2"/><ellipse cx="1.5" cy="-3" rx="1" ry="2.2"/></g>`,
  tundra:
    `<path d="${flake(-3.5, -3, 5)}${flake(5, 2.5, 3)}"/>` +
    `<path d="M-9.5,8h5M-2,8h4M4.5,8h5"/>`,
};

function installSymbols() {
  $('#symbol-defs').innerHTML = TERRAINS.map(t =>
    `<symbol id="sym-${t.id}" viewBox="-10 -10 20 20" overflow="visible">${SYMBOLS[t.id]}</symbol>`).join('');
}

// ---------------------------------------------------------------- geometry
function cornersAt(type, x, y) {
  return type === 'hex' ? HEX_C.map(([a, b]) => [x + a * HS, y + b * HS]) : SQ_C.map(([a, b]) => [x + a, y + b]);
}
const pts = cs => cs.map(p => f(p[0]) + ',' + f(p[1])).join(' ');

function dims(type, w, h, cpm) {
  const W = w * cpm, H = h * cpm;
  const cols = Math.max(1, Math.ceil(W - 1e-6));
  const rows = type === 'square' ? Math.max(1, Math.ceil(H - 1e-6))
                                 : Math.max(1, Math.ceil((H - 2 * HS) / VSTEP - 1e-6) + 1);
  return { cols, rows };
}

function makeGeom(type, cols, rows) {
  const hex = type === 'hex';
  const g = {
    type, cols, rows, n: hex ? 6 : 4,
    width: hex ? cols + (rows > 1 ? 0.5 : 0) : cols,
    height: hex ? 2 * HS + (rows - 1) * VSTEP : rows,
    center: hex ? (c, r) => [c + 0.5 + ((r & 1) ? 0.5 : 0), HS + r * VSTEP] : (c, r) => [c + 0.5, r + 0.5],
    nb: hex ? (c, r, i) => { const d = ((r & 1) ? HEX_ODD : HEX_EVEN)[i]; return [c + d[0], r + d[1]]; }
            : (c, r, i) => [c + SQ_N[i][0], r + SQ_N[i][1]],
    inB: (c, r) => c >= 0 && r >= 0 && c < cols && r < rows,
  };
  g.corners = (c, r) => { const [x, y] = g.center(c, r); return cornersAt(type, x, y); };
  g.mid = (c, r, i) => {
    const cs = g.corners(c, r), a = cs[i], b = cs[(i + 1) % g.n];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  g.pick = hex ? (x, y) => {
    const r0 = Math.round((y - HS) / VSTEP);
    let best = null, bd = Infinity;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const c0 = Math.round(x - 0.5 - ((r & 1) ? 0.5 : 0));
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const [cx, cy] = g.center(c, r), d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bd) { bd = d; best = [c, r]; }
      }
    }
    return best;
  } : (x, y) => [Math.floor(x), Math.floor(y)];
  g.dist = hex ? (c1, r1, c2, r2) => {
    const q1 = c1 - (r1 - (r1 & 1)) / 2, q2 = c2 - (r2 - (r2 & 1)) / 2, dq = q1 - q2, dr = r1 - r2;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  } : (c1, r1, c2, r2) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));
  return g;
}

function edgeKey(c1, r1, c2, r2) {
  const a = key(c1, r1), b = key(c2, r2);
  return a < b ? a + '|' + b : b + '|' + a;
}
function edgeGeom(k) {
  const [a, b] = k.split('|');
  let [ac, ar] = parseKey(a), [bc, br] = parseKey(b);
  if (!G.inB(ac, ar)) [ac, ar, bc, br] = [bc, br, ac, ar];
  for (let i = 0; i < G.n; i++) {
    const [nc, nr] = G.nb(ac, ar, i);
    if (nc === bc && nr === br) {
      const cs = G.corners(ac, ar);
      return { a: cs[i], b: cs[(i + 1) % G.n] };
    }
  }
  return null;
}
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

// ---------------------------------------------------------------- state
function defaultState() {
  return {
    version: 1,
    title: 'Untitled overland map',
    gridType: 'hex', widthMiles: 5, heightMiles: 5, cellsPerMile: 2,
    cols: 0, rows: 0,
    cells: {},   // "c,r" -> { t: terrainId, road: 'highway'|'trail', river: true, cliff: true }
    edges: {},   // "c,r|c,r" -> { river: true, cliff: "c,r" (the low side) }
    roadLinks: {},  // "c,r|c,r" -> true: road runs between these two cells (one may be just off the map)
    riverLinks: {}, // same for rivers running through cells
    view: { colors: true, icons: true, labels: false, coords: false, mileLines: true },
    print: { orientation: 'auto', mode: 'fit', cellInches: 1, margin: 0.5, legend: 'every', refPage: true, color: true },
  };
}
let S, G;
const ui = { tool: 'terrain', terrain: 'plains', road: 'highway', brush: 0, zoom: 1 };
let undoStack = [], redoStack = [];

function normalizeState(raw) {
  const d = defaultState();
  const s = Object.assign(d, raw || {});
  s.view = Object.assign(defaultState().view, raw && raw.view);
  s.print = Object.assign(defaultState().print, raw && raw.print);
  s.cells = s.cells || {}; s.edges = s.edges || {};
  s.roadLinks = s.roadLinks || {}; s.riverLinks = s.riverLinks || {};
  if (s.gridType !== 'square') s.gridType = 'hex';
  if (!(s.cols > 0 && s.rows > 0)) Object.assign(s, dims(s.gridType, s.widthMiles, s.heightMiles, s.cellsPerMile));
  return s;
}

function snapshot() {
  const { title, gridType, widthMiles, heightMiles, cellsPerMile, cols, rows, cells, edges, roadLinks, riverLinks } = S;
  return JSON.stringify({ title, gridType, widthMiles, heightMiles, cellsPerMile, cols, rows, cells, edges, roadLinks, riverLinks });
}
function restore(snap) {
  Object.assign(S, JSON.parse(snap));
  syncSettingsInputs();
  buildSidebar();
  renderAll();
  scheduleSave();
}
function pushUndo(before) {
  undoStack.push(before);
  if (undoStack.length > 150) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateUndoButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateUndoButtons();
}
function updateUndoButtons() {
  $('#btn-undo').disabled = !undoStack.length;
  $('#btn-redo').disabled = !redoStack.length;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: file save still works */ }
  }, 400);
}
function loadSaved() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------- SVG markup builders
function wavy(ax, ay, bx, by, amp = 0.045) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len < 1e-6) return '';
  const waves = Math.max(1, Math.round(len / 0.45)), nx = -dy / len, ny = dx / len, N = waves * 10;
  let d = `M${f(ax)},${f(ay)}`;
  for (let i = 1; i <= N; i++) {
    const t = i / N, o = amp * Math.sin(t * waves * 2 * Math.PI);
    d += `L${f(ax + dx * t + nx * o)},${f(ay + dy * t + ny * o)}`;
  }
  return d;
}
function riverStroke(d) {
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="0.14" stroke-linecap="round" stroke-linejoin="round"/>` +
         `<path d="${d}" fill="none" stroke="${RIVER}" stroke-width="0.075" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function riverMark(x, y, ends) {
  const d = ends.length ? ends.map(m => wavy(x, y, m[0], m[1])).join('') : wavy(x - 0.32, y, x + 0.32, y);
  return riverStroke(d);
}
function roadMark(x, y, ends, type) {
  const d = ends.length ? ends.map(m => `M${f(x)},${f(y)}L${f(m[0])},${f(m[1])}`).join('')
                        : `M${f(x - 0.28)},${f(y)}L${f(x + 0.28)},${f(y)}`;
  if (type === 'highway') {
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="0.16"/><circle cx="${f(x)}" cy="${f(y)}" r="0.08" fill="${INK}"/>` +
           `<path d="${d}" fill="none" stroke="#fff" stroke-width="0.075"/><circle cx="${f(x)}" cy="${f(y)}" r="0.0375" fill="#fff"/>`;
  }
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="0.1"/><circle cx="${f(x)}" cy="${f(y)}" r="0.05" fill="#fff"/>` +
         `<path d="${d}" fill="none" stroke="${INK}" stroke-width="0.05" stroke-dasharray="0.08 0.05"/>`;
}
// A cliff line from a to b with triangular teeth pointing toward (lx, ly), the low side.
function cliffMark(ax, ay, bx, by, lx, ly) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  let nx = -uy, ny = ux;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  if ((lx - mx) * nx + (ly - my) * ny < 0) { nx = -nx; ny = -ny; }
  const n = Math.max(2, Math.round(len / 0.12)), bw = 0.032, tl = 0.1;
  let teeth = '';
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n, px = ax + dx * t, py = ay + dy * t;
    teeth += `M${f(px - ux * bw)},${f(py - uy * bw)}L${f(px + nx * tl)},${f(py + ny * tl)}L${f(px + ux * bw)},${f(py + uy * bw)}Z`;
  }
  const line = `M${f(ax)},${f(ay)}L${f(bx)},${f(by)}`;
  return `<path d="${line}" stroke="#fff" stroke-width="0.12" stroke-linecap="round"/>` +
         `<path d="${teeth}" fill="#fff" stroke="#fff" stroke-width="0.05" stroke-linejoin="round"/>` +
         `<path d="${line}" stroke="${INK}" stroke-width="0.055" stroke-linecap="round"/>` +
         `<path d="${teeth}" fill="${INK}"/>`;
}
function cellCliffMark(x, y) { return cliffMark(x - 0.34, y + 0.24, x + 0.34, y + 0.24, x, y + 1); }

function iconStrokeWidth(ro) { return f(ro.lw * 1.15 * 20 / (ro.labels ? 0.48 : 0.62)); }
function iconGroupAttrs(ro) {
  return `stroke="${INK}" color="${INK}" fill="none" stroke-width="${iconStrokeWidth(ro)}" stroke-linecap="round" stroke-linejoin="round"`;
}
function terrainMark(id, x, y, ro) {
  const t = TMAP[id];
  if (!t) return '';
  const off = ro.coords ? 0.04 : 0;
  let out = '';
  if (ro.icons) {
    const s = ro.labels ? 0.48 : 0.62, cy = y + off - (ro.labels ? 0.08 : 0);
    out += `<use href="#sym-${id}" x="${f(x - s / 2)}" y="${f(cy - s / 2)}" width="${s}" height="${s}"/>`;
  }
  if (ro.labels) {
    const fs = ro.icons ? 0.17 : 0.3, ty = ro.icons ? y + 0.34 : y + 0.1 + off;
    out += `<text x="${f(x)}" y="${f(ty)}" font-size="${fs}" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="${INK}" stroke="none">${t.abbr}</text>`;
  }
  return out;
}
function coordLabel(c, r) {
  const w = Math.max(2, String(Math.max(S.cols, S.rows)).length);
  return String(c + 1).padStart(w, '0') + '.' + String(r + 1).padStart(w, '0');
}

function cellFillSVG(c, r, ro) {
  const cell = S.cells[key(c, r)], t = cell && cell.t && TMAP[cell.t];
  return `<polygon points="${pts(G.corners(c, r))}" fill="${t && ro.colors ? t.color : '#fff'}"/>`;
}
function cellIconSVG(c, r, ro) {
  const cell = S.cells[key(c, r)];
  if (!cell || !cell.t) return '';
  const [x, y] = G.center(c, r);
  return terrainMark(cell.t, x, y, ro);
}
// Edge midpoints toward every neighbor this cell's road/river is linked to.
function linkEnds(c, r, prop) {
  const links = S[LINK_SETS[prop]], e = [];
  for (let i = 0; i < G.n; i++) {
    const [nc, nr] = G.nb(c, r, i);
    if (links[edgeKey(c, r, nc, nr)]) e.push(G.mid(c, r, i));
  }
  return e;
}
function cellFeatSVG(c, r) {
  const cell = S.cells[key(c, r)];
  if (!cell) return '';
  const [x, y] = G.center(c, r);
  let out = '';
  if (cell.river) out += riverMark(x, y, linkEnds(c, r, 'river'));
  if (cell.cliff) out += cellCliffMark(x, y);
  if (cell.road) out += roadMark(x, y, linkEnds(c, r, 'road'), cell.road);
  return out;
}
function edgesSVG(vb) {
  let rivers = '', cliffs = '';
  for (const [k, e] of Object.entries(S.edges)) {
    const g = edgeGeom(k);
    if (!g) continue;
    if (vb && !inView(vb, (g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2)) continue;
    if (e.river) rivers += riverStroke(wavy(g.a[0], g.a[1], g.b[0], g.b[1], 0.05));
    if (e.cliff) {
      const [lc, lr] = parseKey(e.cliff), [lx, ly] = G.center(lc, lr);
      cliffs += cliffMark(g.a[0], g.a[1], g.b[0], g.b[1], lx, ly);
    }
  }
  return rivers + cliffs;
}
function gridSVG(ro, vb) {
  let d = '';
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    if (vb && !inView(vb, ...G.center(c, r))) continue;
    const cs = G.corners(c, r);
    d += 'M' + cs.map(p => f(p[0]) + ',' + f(p[1])).join('L') + 'Z';
  }
  let out = `<path d="${d}" fill="none" stroke="${GRID}" stroke-width="${f(ro.lw * 0.9)}" stroke-linejoin="round"/>`;
  const cpm = S.cellsPerMile;
  if (G.type === 'square' && ro.mileLines && cpm > 1 && Math.abs(cpm - Math.round(cpm)) < 1e-9) {
    let m = '';
    for (let c = 0; c <= S.cols; c += cpm) m += `M${c},0V${S.rows}`;
    for (let r = 0; r <= S.rows; r += cpm) m += `M0,${r}H${S.cols}`;
    out += `<path d="${m}" fill="none" stroke="${INK}" stroke-width="${f(ro.lw * 2.6)}"/>`;
  }
  return out;
}
function inView(vb, x, y) { return x > vb.x - 1 && x < vb.x + vb.w + 1 && y > vb.y - 1 && y < vb.y + vb.h + 1; }

/* Whole-map SVG content. In the editor (wrap=true) every cell gets its own <g> in each
 * layer so single cells can be redrawn. For print, vb limits output to the visible page. */
function mapContentSVG(ro, vb, wrap) {
  let fill = '', icon = '', coord = '', feat = '';
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    if (vb && !inView(vb, ...G.center(c, r))) continue;
    const fi = cellFillSVG(c, r, ro), ic = cellIconSVG(c, r, ro), fe = cellFeatSVG(c, r);
    if (wrap) { fill += `<g>${fi}</g>`; icon += `<g>${ic}</g>`; feat += `<g>${fe}</g>`; }
    else { fill += fi; icon += ic; feat += fe; }
    if (ro.coords) {
      const [x, y] = G.center(c, r);
      coord += `<text x="${f(x)}" y="${f(y - 0.36)}">${coordLabel(c, r)}</text>`;
    }
  }
  return `<g class="L-fill">${fill}</g>` +
    `<g class="L-grid">${gridSVG(ro, vb)}</g>` +
    `<g class="L-icon" ${iconGroupAttrs(ro)}>${icon}</g>` +
    `<g class="L-coord" font-size="0.11" font-family="${FONT}" fill="#333" text-anchor="middle">${coord}</g>` +
    `<g class="L-feat">${feat}</g>` +
    `<g class="L-edge">${edgesSVG(vb)}</g>`;
}

// ---------------------------------------------------------------- editor rendering
const svg = $('#map');
let layers = {};

function editorRO() { return Object.assign({ lw: 1.3 / PX }, S.view); }

function renderAll() {
  G = makeGeom(S.gridType, S.cols, S.rows);
  const W = G.width + 2 * PAD, H = G.height + 2 * PAD;
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${f(W)} ${f(H)}`);
  svg.innerHTML = mapContentSVG(editorRO(), null, true) + '<g class="L-hover" pointer-events="none"></g>';
  for (const n of ['fill', 'icon', 'feat', 'edge', 'hover']) layers[n] = svg.querySelector('.L-' + n);
  applyZoom();
  updateMapInfo();
  $('#map-title').value = S.title;
}

function redrawCells(set) {
  const ro = editorRO();
  for (const k of set) {
    const [c, r] = parseKey(k);
    if (!G.inB(c, r)) continue;
    const i = r * S.cols + c;
    layers.fill.children[i].innerHTML = cellFillSVG(c, r, ro);
    layers.icon.children[i].innerHTML = cellIconSVG(c, r, ro);
    layers.feat.children[i].innerHTML = cellFeatSVG(c, r);
  }
}
function withNeighbors(set) {
  const out = new Set(set);
  for (const k of set) {
    const [c, r] = parseKey(k);
    for (let i = 0; i < G.n; i++) out.add(key(...G.nb(c, r, i)));
  }
  return out;
}
function redrawEdges() { layers.edge.innerHTML = edgesSVG(null); }

function applyZoom() {
  const W = G.width + 2 * PAD, H = G.height + 2 * PAD;
  svg.style.width = Math.round(W * PX * ui.zoom) + 'px';
  svg.style.height = Math.round(H * PX * ui.zoom) + 'px';
  $('#zoom-label').textContent = Math.round(ui.zoom * 100) + '%';
}
function setZoom(z, anchor) {
  const sc = $('#scroller');
  const old = ui.zoom;
  ui.zoom = clamp(z, 0.15, 6);
  let ax = sc.clientWidth / 2, ay = sc.clientHeight / 2;
  if (anchor) { const rect = sc.getBoundingClientRect(); ax = anchor.clientX - rect.left; ay = anchor.clientY - rect.top; }
  const mx = (sc.scrollLeft + ax) / old, my = (sc.scrollTop + ay) / old;
  applyZoom();
  sc.scrollLeft = mx * ui.zoom - ax;
  sc.scrollTop = my * ui.zoom - ay;
}
function zoomFit() {
  const sc = $('#scroller');
  const W = (G.width + 2 * PAD) * PX, H = (G.height + 2 * PAD) * PX;
  setZoom(Math.min((sc.clientWidth - 30) / W, (sc.clientHeight - 30) / H));
}

function cellWord(plural) { return (S.gridType === 'hex' ? 'hex' : 'square') + (plural ? (S.gridType === 'hex' ? 'es' : 's') : ''); }
function scaleText() {
  const cpm = S.cellsPerMile, mi = 1 / cpm, ft = Math.round(5280 / cpm);
  return `1 ${cellWord()} = ${fmtNum(mi)} mile${mi <= 1 ? '' : 's'} across (${ft.toLocaleString()} ft) · ${fmtNum(cpm)} ${cellWord(cpm !== 1)} per mile`;
}
function updateMapInfo() {
  const cpm = S.cellsPerMile;
  $('#map-info').textContent = `${S.cols} × ${S.rows} ${cellWord(true)} · covers ${fmtNum(G.width / cpm)} × ${fmtNum(G.height / cpm)} mi · ${scaleText()}`;
}

// ---------------------------------------------------------------- painting
let stroke = null;
let spaceDown = false, pan = null;

function evtPt(e) {
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return [q.x, q.y];
}
function pickEdge(x, y) {
  const [c, r] = G.pick(x, y), cs = G.corners(c, r);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < G.n; i++) {
    const d = segDist(x, y, cs[i], cs[(i + 1) % G.n]);
    if (d < bd) { bd = d; bi = i; }
  }
  const [nc, nr] = G.nb(c, r, bi);
  if (!G.inB(c, r) && !G.inB(nc, nr)) return null;
  return { key: edgeKey(c, r, nc, nr), cell: key(c, r), a: cs[bi], b: cs[(bi + 1) % G.n] };
}
function cellsWithin(c, r, rad) {
  const out = [];
  for (let rr = r - rad; rr <= r + rad; rr++) for (let cc = c - rad - 1; cc <= c + rad + 1; cc++) {
    if (G.inB(cc, rr) && G.dist(c, r, cc, rr) <= rad) out.push([cc, rr]);
  }
  return out;
}
function sameCell(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}
function setCell(k, n) { if (Object.keys(n).length) S.cells[k] = n; else delete S.cells[k]; }

function applyCell(c, r) {
  const k = key(c, r), cur = S.cells[k] || {}, n = Object.assign({}, cur), er = stroke.erase;
  switch (ui.tool) {
    case 'terrain': if (er) delete n.t; else n.t = ui.terrain; break;
    case 'cliff-cell': if (stroke.mode === 'add') n.cliff = true; else delete n.cliff; break;
    case 'erase': for (const p of Object.keys(n)) delete n[p]; break;
  }
  let changed = false;
  if (ui.tool === 'erase') changed = unlinkCell(c, r, 'road') | unlinkCell(c, r, 'river');
  if (sameCell(cur, n)) return !!changed;
  setCell(k, n);
  return true;
}
function isNbIn(g, c1, r1, c2, r2) {
  for (let i = 0; i < g.n; i++) { const [nc, nr] = g.nb(c1, r1, i); if (nc === c2 && nr === r2) return true; }
  return false;
}
const isNb = (c1, r1, c2, r2) => isNbIn(G, c1, r1, c2, r2);
// Remove every road/river link touching a cell. Returns true if anything was removed.
function unlinkCell(c, r, prop) {
  const links = S[LINK_SETS[prop]];
  let any = false;
  for (let i = 0; i < G.n; i++) {
    const lk = edgeKey(c, r, ...G.nb(c, r, i));
    if (links[lk]) { delete links[lk]; any = true; }
  }
  return any;
}
/* Roads and in-cell rivers: dragging from one cell into a neighbor links the two, so the
 * line follows the path drawn. A neighbor just off the map can be linked too (flows off the edge). */
function linkPaint(c, r) {
  const prop = LINK_TOOLS[ui.tool], links = S[LINK_SETS[prop]], k = key(c, r), inside = G.inB(c, r);
  const dirty = new Set();
  if (stroke.erase || (prop === 'road' && ui.road === 'none')) {
    if (!inside) return;
    const cur = S.cells[k];
    if (unlinkCell(c, r, prop)) dirty.add(k);
    if (cur && cur[prop]) { const n = Object.assign({}, cur); delete n[prop]; setCell(k, n); dirty.add(k); }
  } else {
    const prev = stroke.prevCell;
    if (!inside && !(prev && G.inB(...parseKey(prev)))) { stroke.prevCell = null; return; }
    if (inside) {
      const cur = S.cells[k] || {}, val = prop === 'road' ? ui.road : true;
      if (cur[prop] !== val) { setCell(k, Object.assign({}, cur, { [prop]: val })); dirty.add(k); }
    }
    if (prev) {
      const [pc, pr] = parseKey(prev), lk = edgeKey(pc, pr, c, r);
      if (isNb(pc, pr, c, r) && !links[lk]) { links[lk] = true; dirty.add(k); dirty.add(prev); }
    }
    stroke.prevCell = k;
  }
  if (dirty.size) { stroke.changed = true; redrawCells(withNeighbors(dirty)); }
}

function applyEdgeAt(x, y) {
  const e = pickEdge(x, y);
  if (!e || e.key === stroke.lastEdge) return;
  stroke.lastEdge = e.key;
  const prop = EDGE_TOOLS[ui.tool], cur = S.edges[e.key];
  if (stroke.shift && prop === 'cliff') {
    if (cur && cur.cliff) {
      const [a, b] = e.key.split('|');
      S.edges[e.key] = Object.assign({}, cur, { cliff: cur.cliff === a ? b : a });
      stroke.changed = true;
      redrawEdges();
    }
    return;
  }
  if (!stroke.mode) stroke.mode = (stroke.erase || (cur && cur[prop])) ? 'remove' : 'add';
  if (stroke.mode === 'add') {
    const val = prop === 'cliff' ? e.cell : true;
    if (!cur || cur[prop] !== val) { S.edges[e.key] = Object.assign({}, cur, { [prop]: val }); stroke.changed = true; }
  } else if (cur && cur[prop]) {
    const n = Object.assign({}, cur);
    delete n[prop];
    if (Object.keys(n).length) S.edges[e.key] = n; else delete S.edges[e.key];
    stroke.changed = true;
  }
  redrawEdges();
}

function applyAt(x, y) {
  if (EDGE_TOOLS[ui.tool]) return applyEdgeAt(x, y);
  const [c, r] = G.pick(x, y);
  const k = key(c, r);
  if (k === stroke.lastCell) return;
  if (LINK_TOOLS[ui.tool]) { stroke.lastCell = k; return linkPaint(c, r); }
  if (!G.inB(c, r)) return;
  stroke.lastCell = k;
  if (!stroke.mode && ui.tool === 'cliff-cell') {
    const cur = S.cells[k];
    stroke.mode = (stroke.erase || (cur && cur.cliff)) ? 'remove' : 'add';
  }
  const targets = BRUSH_TOOLS.has(ui.tool) && ui.brush > 0 ? cellsWithin(c, r, ui.brush) : [[c, r]];
  const dirty = new Set();
  for (const [cc, rr] of targets) if (applyCell(cc, rr)) dirty.add(key(cc, rr));
  if (dirty.size) { stroke.changed = true; redrawCells(withNeighbors(dirty)); }
}

function floodFill(c, r, erase) {
  if (!G.inB(c, r)) return false;
  const startCell = S.cells[key(c, r)], start = startCell && startCell.t;
  const target = erase ? undefined : ui.terrain;
  if (start === target) return false;
  const seen = new Set([key(c, r)]), queue = [[c, r]], dirty = new Set();
  while (queue.length) {
    const [cc, rr] = queue.pop(), k = key(cc, rr);
    const n = Object.assign({}, S.cells[k]);
    if (target) n.t = target; else delete n.t;
    setCell(k, n);
    dirty.add(k);
    for (let i = 0; i < G.n; i++) {
      const [nc, nr] = G.nb(cc, rr, i), nk = key(nc, nr);
      if (!G.inB(nc, nr) || seen.has(nk)) continue;
      const o = S.cells[nk];
      if ((o && o.t) === start) { seen.add(nk); queue.push([nc, nr]); }
    }
  }
  redrawCells(dirty);
  return true;
}

function onPointerDown(e) {
  if (e.button === 1 || spaceDown) { startPan(e); return; }
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  svg.setPointerCapture(e.pointerId);
  const [x, y] = evtPt(e);
  stroke = { before: snapshot(), erase: e.button === 2, shift: e.shiftKey, mode: null, changed: false,
             lastCell: null, lastEdge: null, lastPt: [x, y], pointerId: e.pointerId };
  if (ui.tool === 'fill') {
    const [c, r] = G.pick(x, y);
    stroke.changed = floodFill(c, r, stroke.erase);
    endStroke();
    return;
  }
  applyAt(x, y);
  stroke.shift = false;
}
function onPointerMove(e) {
  if (pan) { doPan(e); return; }
  const [x, y] = evtPt(e);
  showHover(x, y);
  if (!stroke || e.pointerId !== stroke.pointerId) return;
  const [lx, ly] = stroke.lastPt, steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / 0.2));
  for (let i = 1; i <= steps; i++) applyAt(lx + (x - lx) * i / steps, ly + (y - ly) * i / steps);
  stroke.lastPt = [x, y];
}
function endStroke() {
  if (!stroke) return;
  if (stroke.changed) { pushUndo(stroke.before); scheduleSave(); }
  stroke = null;
}
function onPointerUp(e) {
  if (pan) { endPan(); return; }
  if (stroke && e.pointerId === stroke.pointerId) endStroke();
}

function startPan(e) {
  e.preventDefault();
  const sc = $('#scroller');
  pan = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
  svg.setPointerCapture(e.pointerId);
  sc.classList.add('panning');
}
function doPan(e) {
  const sc = $('#scroller');
  sc.scrollLeft = pan.sl - (e.clientX - pan.x);
  sc.scrollTop = pan.st - (e.clientY - pan.y);
}
function endPan() { pan = null; if (!spaceDown) $('#scroller').classList.remove('panning'); }

function hl(d) {
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="0.11" stroke-linejoin="round"/>` +
         `<path d="${d}" fill="none" stroke="#d40000" stroke-width="0.05" stroke-dasharray="0.09 0.06" stroke-linejoin="round"/>`;
}
function showHover(x, y) {
  if (EDGE_TOOLS[ui.tool]) {
    const e = pickEdge(x, y);
    layers.hover.innerHTML = e ? hl(`M${f(e.a[0])},${f(e.a[1])}L${f(e.b[0])},${f(e.b[1])}`) : '';
  }
  const [c, r] = G.pick(x, y);
  if (!G.inB(c, r)) {
    if (!EDGE_TOOLS[ui.tool]) layers.hover.innerHTML = '';
    $('#status').textContent = ' ';
    return;
  }
  if (!EDGE_TOOLS[ui.tool]) {
    const targets = BRUSH_TOOLS.has(ui.tool) && ui.brush > 0 ? cellsWithin(c, r, ui.brush) : [[c, r]];
    layers.hover.innerHTML = hl(targets.map(([cc, rr]) => 'M' + G.corners(cc, rr).map(p => f(p[0]) + ',' + f(p[1])).join('L') + 'Z').join(''));
  }
  $('#status').textContent = cellInfo(c, r);
}
function cellInfo(c, r) {
  const cell = S.cells[key(c, r)] || {};
  const parts = [`${S.gridType === 'hex' ? 'Hex' : 'Square'} ${coordLabel(c, r)}`];
  parts.push(cell.t ? TMAP[cell.t].name : '(no terrain)');
  parts.push(cell.road ? ROAD_NAME[cell.road] : 'Trackless');
  if (cell.t) {
    const i = cell.road === 'highway' ? 0 : cell.road === 'trail' ? 1 : 2;
    parts.push(`overland speed ${frac(TMAP[cell.t].mv[i])}`);
  }
  if (cell.river) parts.push('river');
  if (cell.cliff) parts.push('cliff');
  return parts.join('  ·  ');
}

// ---------------------------------------------------------------- map setup (resize / rescale)
function readSetupInputs() {
  const type = document.querySelector('input[name="gridType"]:checked').value;
  const w = parseFloat($('#set-width').value), h = parseFloat($('#set-height').value), cpm = parseFloat($('#set-cpm').value);
  return { type, w, h, cpm, ok: w > 0 && h > 0 && cpm > 0 };
}
function updateSetupPreview() {
  const s = readSetupInputs(), el = $('#setup-preview');
  if (!s.ok) { el.textContent = 'Enter a width, height and cells per mile above zero.'; return; }
  const d = dims(s.type, s.w, s.h, s.cpm), g = makeGeom(s.type, d.cols, d.rows);
  const word = s.type === 'hex' ? 'hexes' : 'squares', one = s.type === 'hex' ? 'hex' : 'square';
  const total = d.cols * d.rows;
  el.innerHTML = `→ <b>${d.cols} × ${d.rows} ${word}</b> (${total.toLocaleString()} cells), covering ${fmtNum(g.width / s.cpm)} × ${fmtNum(g.height / s.cpm)} miles.<br>` +
    `1 ${one} = ${fmtNum(1 / s.cpm)} mi = ${Math.round(5280 / s.cpm).toLocaleString()} ft across.` +
    (total > MAX_CELLS ? `<br><b>Too many cells (limit ${MAX_CELLS.toLocaleString()}).</b>` : '');
}
function applySetup() {
  const s = readSetupInputs();
  if (!s.ok) return;
  const d = dims(s.type, s.w, s.h, s.cpm);
  if (d.cols * d.rows > MAX_CELLS) { alert(`That would be ${(d.cols * d.rows).toLocaleString()} cells; the limit is ${MAX_CELLS.toLocaleString()}. Use fewer cells per mile or a smaller area.`); return; }
  const sameGrid = s.type === S.gridType && s.cpm === S.cellsPerMile;
  const edgeCount = Object.keys(S.edges).length;
  if (!sameGrid && edgeCount && !confirm(`Changing the grid type or cells per mile removes the ${edgeCount} river/cliff segment(s) drawn on cell borders. (Painted terrain, roads and in-cell rivers/cliffs are re-fitted to the new grid.) Continue?`)) return;
  const before = snapshot();
  const oldG = G, oldCpm = S.cellsPerMile, oldCells = S.cells;
  const newG = makeGeom(s.type, d.cols, d.rows), cells = {};
  // Resample by ground position: the new cell takes whatever old cell sat at its center.
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    let src;
    if (sameGrid) src = key(c, r);
    else {
      const [x, y] = newG.center(c, r), k = oldCpm / s.cpm;
      const [oc, or] = oldG.pick(x * k, y * k);
      src = oldG.inB(oc, or) ? key(oc, or) : null;
    }
    if (src && oldCells[src]) cells[key(c, r)] = Object.assign({}, oldCells[src]);
  }
  let roadLinks = {}, riverLinks = {};
  if (sameGrid) {
    const keep = links => Object.fromEntries(Object.keys(links).filter(lk => {
      const [p, q] = lk.split('|').map(parseKey);
      return newG.inB(...p) || newG.inB(...q);
    }).map(lk => [lk, true]));
    roadLinks = keep(S.roadLinks); riverLinks = keep(S.riverLinks);
  } else {
    // Line features don't resample well cell-by-cell, so re-trace them: strip them from the copied
    // cells, put each old point feature in the new cell under its center, and redraw each old link
    // as a straight walk through the new grid.
    for (const k of Object.keys(cells)) {
      const n = cells[k];
      delete n.road; delete n.river; delete n.cliff;
      if (!Object.keys(n).length) delete cells[k];
    }
    const sc = s.cpm / oldCpm;
    const newAt = (oc, or) => { const [x, y] = oldG.center(oc, or); return newG.pick(x * sc, y * sc); };
    const put = (c, r, prop, val) => {
      if (!newG.inB(c, r)) return;
      const k = key(c, r);
      cells[k] = Object.assign(cells[k] || {}, { [prop]: val });
    };
    for (const [k, cell] of Object.entries(oldCells)) {
      const [oc, or] = parseKey(k), [nc, nr] = newAt(oc, or);
      for (const prop of ['road', 'river', 'cliff']) if (cell[prop]) put(nc, nr, prop, cell[prop]);
    }
    const retrace = (prop, out) => {
      for (const lk of Object.keys(S[LINK_SETS[prop]])) {
        const [ka, kb] = lk.split('|'), A = parseKey(ka), B = parseKey(kb);
        const va = (oldCells[ka] || {})[prop] || (oldCells[kb] || {})[prop];
        const vb = (oldCells[kb] || {})[prop] || va;
        const [ax, ay] = oldG.center(...A), [bx, by] = oldG.center(...B);
        const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * sc / 0.15));
        let prev = null;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, cur = newG.pick((ax + (bx - ax) * t) * sc, (ay + (by - ay) * t) * sc);
          if (prev && key(...cur) === key(...prev)) continue;
          if (newG.inB(...cur)) put(...cur, prop, t < 0.5 ? va : vb);
          if (prev) {
            let mids = [];
            if (!isNbIn(newG, ...prev, ...cur)) mids = [[cur[0], prev[1]]];   // squares: stepped diagonally across a corner
            let from = prev;
            for (const m of [...mids, cur]) {
              if (mids.length && m !== cur && newG.inB(...m)) put(...m, prop, t < 0.5 ? va : vb);
              if (isNbIn(newG, ...from, ...m) && (newG.inB(...from) || newG.inB(...m))) out[edgeKey(...from, ...m)] = true;
              from = m;
            }
          }
          prev = cur;
        }
      }
    };
    retrace('road', roadLinks);
    retrace('river', riverLinks);
  }
  let edges = {};
  if (sameGrid) {
    for (const [k, e] of Object.entries(S.edges)) {
      const [a, b] = k.split('|').map(parseKey);
      if (newG.inB(...a) || newG.inB(...b)) edges[k] = e;
    }
  }
  Object.assign(S, { gridType: s.type, widthMiles: s.w, heightMiles: s.h, cellsPerMile: s.cpm, cols: d.cols, rows: d.rows, cells, edges, roadLinks, riverLinks });
  pushUndo(before);
  renderAll();
  zoomFit();
  scheduleSave();
}
function syncSettingsInputs() {
  document.querySelectorAll('input[name="gridType"]').forEach(i => { i.checked = i.value === S.gridType; });
  $('#set-width').value = S.widthMiles;
  $('#set-height').value = S.heightMiles;
  $('#set-cpm').value = S.cellsPerMile;
  updateSetupPreview();
}

// ---------------------------------------------------------------- swatches & sidebar
function swatchSVG(kind, type, sizeAttr = '') {
  const ro = { lw: 0.035, colors: true, icons: true, labels: false, coords: false };
  const shape = `<polygon points="${pts(cornersAt(type, 0, 0))}" fill="${TMAP[kind] ? TMAP[kind].color : '#fff'}" stroke="${GRID}" stroke-width="0.035"/>`;
  return `<svg viewBox="-0.6 -0.62 1.2 1.24" ${sizeAttr} aria-hidden="true">${shape}${featureSwatch(kind, ro)}</svg>`;
}
function featureSwatch(kind, ro) {
  const ends = [[-0.5, 0], [0.5, 0]];
  if (TMAP[kind]) return `<g ${iconGroupAttrs(ro)}>${terrainMark(kind, 0, 0, ro)}</g>`;
  if (kind === 'highway' || kind === 'trail') return roadMark(0, 0, ends, kind);
  if (kind === 'river') return riverMark(0, 0, ends);
  if (kind === 'cliff') return cliffMark(-0.36, -0.04, 0.36, -0.04, 0, 1);
  return '';
}
function buildSidebar() {
  $('#terrain-palette').innerHTML = TERRAINS.map((t, i) =>
    `<button data-terrain="${t.id}" aria-pressed="false">${swatchSVG(t.id, S.gridType)}<span class="name">${t.name}</span><span class="key">${i + 1}</span></button>`).join('');
  $('#road-palette').innerHTML = ROADS.map(r =>
    `<button data-road="${r.id}" aria-pressed="false">${swatchSVG(r.id === 'none' ? 'blank' : r.id, S.gridType)}<span class="name">${r.name}</span></button>`).join('');
  document.querySelectorAll('[data-view]').forEach(cb => { cb.checked = !!S.view[cb.dataset.view]; });
  $('#movement-table').innerHTML = movementTableHTML('mv', 'width="22" height="22"');
  refreshToolUI();
}
function movementTableHTML(cls, swAttr) {
  return `<table class="${cls}"><thead><tr><th>Terrain</th><th>Highway</th><th>Road or trail</th><th>Trackless</th></tr></thead><tbody>` +
    TERRAINS.map(t => `<tr><td>${swatchSVG(t.id, S.gridType, swAttr)}${t.name}</td>${t.mv.map(v => `<td>${frac(v)}</td>`).join('')}</tr>`).join('') +
    `</tbody></table>`;
}
function refreshToolUI() {
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === ui.tool)));
  document.querySelectorAll('[data-terrain]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.terrain === ui.terrain && (ui.tool === 'terrain' || ui.tool === 'fill'))));
  document.querySelectorAll('[data-road]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.road === ui.road && ui.tool === 'road')));
  document.querySelectorAll('[data-brush]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.brush === ui.brush)));
  $('#brush-row').style.visibility = BRUSH_TOOLS.has(ui.tool) ? 'visible' : 'hidden';
  $('#tool-hint').textContent = TOOL_HINTS[ui.tool];
  if (layers.hover) layers.hover.innerHTML = '';
}
function setTool(t) { ui.tool = t; refreshToolUI(); }

// ---------------------------------------------------------------- printing
const HEAD_H = 0.45, LEG_IW = 1.06, LEG_RH = 0.4;
const LEGEND_ITEMS = () => [
  ...TERRAINS.map(t => ({ kind: t.id, label: t.name })),
  { kind: 'highway', label: 'Highway' }, { kind: 'trail', label: 'Road / trail' },
  { kind: 'river', label: 'River' }, { kind: 'cliff', label: 'Cliff' },
];
function legendHeight(width, z = 1) {
  const per = Math.max(1, Math.floor(width / (LEG_IW * z)));
  return Math.ceil(LEGEND_ITEMS().length / per) * LEG_RH * z + 0.04;
}
function legendSVG(width, ro, z = 1) {
  const items = LEGEND_ITEMS(), per = Math.max(1, Math.floor(width / (LEG_IW * z))), iw = width / per;
  const h = legendHeight(width, z), k = 0.3 * z;
  const sro = Object.assign({}, ro, { lw: 0.011 / k, coords: false });
  let out = '';
  items.forEach((it, i) => {
    const x = (i % per) * iw, y = Math.floor(i / per) * LEG_RH * z;
    const t = TMAP[it.kind];
    out += `<g transform="translate(${f(x + 0.18 * z)},${f(y + 0.2 * z)}) scale(${f(k)})">` +
      `<polygon points="${pts(cornersAt(S.gridType, 0, 0))}" fill="${t && ro.colors ? t.color : '#fff'}" stroke="${GRID}" stroke-width="${f(sro.lw)}"/>` +
      featureSwatch(it.kind, sro) + `</g>` +
      `<text x="${f(x + 0.37 * z)}" y="${f(y + 0.245 * z)}" font-size="${f(0.125 * z)}" font-family="${FONT}" fill="#111">${it.label}</text>`;
  });
  return `<svg viewBox="0 0 ${f(width)} ${f(h)}" style="width:${f(width)}in;height:${f(h)}in;display:block">${out}</svg>`;
}

function printLayout() {
  const P = S.print, m = clamp(+P.margin || 0.5, 0.2, 1.5);
  const Wu = G.width + 2 * PAD, Hu = G.height + 2 * PAD;
  const evalO = o => {
    const pw = o === 'landscape' ? 11 : 8.5, ph = o === 'landscape' ? 8.5 : 11;
    const cw = pw - 2 * m, ch = ph - 2 * m - 0.08;   // a hair of slack so browsers don't spill a blank page
    const legH = P.legend === 'every' ? legendHeight(cw) : 0;
    const mw = cw, mh = ch - HEAD_H - 0.05 - (legH ? legH + 0.12 : 0);
    let cellIn, px = 1, py = 1;
    if (P.mode === 'fit') cellIn = Math.min(mw / Wu, mh / Hu);
    else {
      cellIn = clamp(+P.cellInches || 1, 0.2, 4);
      px = Math.ceil(Wu * cellIn / mw - 1e-6);
      py = Math.ceil(Hu * cellIn / mh - 1e-6);
    }
    return { o, m, pw, ph, cw, ch, mw, mh, legH, cellIn, px, py, pages: px * py, Wu, Hu };
  };
  if (P.orientation === 'auto') {
    const a = evalO('portrait'), b = evalO('landscape');
    if (P.mode === 'fit') return b.cellIn > a.cellIn * 1.02 ? b : a;
    return b.pages < a.pages ? b : a;
  }
  return evalO(P.orientation === 'landscape' ? 'landscape' : 'portrait');
}
function printRO(L) {
  return Object.assign({}, S.view, { lw: clamp(0.011 / L.cellIn, 0.008, 0.05), colors: !!S.print.color });
}
function scaleBarSVG(L) {
  const ipm = S.cellsPerMile * L.cellIn;        // inches per mile on paper
  const opts = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 20];
  let len = opts[0];
  for (const o of opts) if (o * ipm <= 1.8) len = o;
  const w = len * ipm, segs = 4, h = 0.24;
  let bars = '';
  for (let i = 0; i < segs; i++) bars += `<rect x="${f(0.05 + i * w / segs)}" y="0.03" width="${f(w / segs)}" height="0.06" fill="${i % 2 ? '#fff' : '#111'}" stroke="#111" stroke-width="0.01"/>`;
  const tw = w + 0.6;
  return `<svg viewBox="0 0 ${f(tw)} ${h}" style="width:${f(tw)}in;height:${h}in">${bars}` +
    `<text x="0.05" y="0.21" font-size="0.1" font-family="${FONT}" text-anchor="middle">0</text>` +
    `<text x="${f(0.05 + w)}" y="0.21" font-size="0.1" font-family="${FONT}" text-anchor="middle">${fmtNum(len)}</text>` +
    `<text x="${f(0.12 + w)}" y="0.1" font-size="0.1" font-family="${FONT}">mile${len === 1 ? '' : 's'}</text></svg>`;
}
function pageMapSVG(L, ix, iy) {
  const s = 0.11;
  let r = '';
  for (let y = 0; y < L.py; y++) for (let x = 0; x < L.px; x++)
    r += `<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}" fill="${x === ix && y === iy ? '#111' : '#fff'}" stroke="#111" stroke-width="0.012"/>`;
  return `<svg viewBox="-0.01 -0.01 ${f(L.px * s + 0.02)} ${f(L.py * s + 0.02)}" style="width:${f(L.px * s + 0.02)}in;height:${f(L.py * s + 0.02)}in">${r}</svg>`;
}
function buildPages() {
  const L = printLayout(), ro = printRO(L), pages = [];
  const total = L.pages + (S.print.refPage ? 1 : 0);
  const legend = L.legH ? `<div class="pp-legend">${legendSVG(L.cw, ro)}</div>` : '';
  const tiled = L.pages > 1 || S.print.mode === 'size';
  let n = 0;
  for (let iy = 0; iy < L.py; iy++) for (let ix = 0; ix < L.px; ix++) {
    n++;
    let vbx, vby, vbw, vbh, sw, sh;
    if (tiled) {
      vbw = L.mw / L.cellIn; vbh = L.mh / L.cellIn;
      vbx = -PAD + ix * vbw; vby = -PAD + iy * vbh;
      // Shrink the last row/column of pages to the map's real extent.
      vbw = Math.min(vbw, L.Wu - ix * vbw); vbh = Math.min(vbh, L.Hu - iy * vbh);
      sw = vbw * L.cellIn; sh = vbh * L.cellIn;
    } else {
      vbx = -PAD; vby = -PAD; vbw = L.Wu; vbh = L.Hu; sw = L.Wu * L.cellIn; sh = L.Hu * L.cellIn;
    }
    const vb = { x: vbx, y: vby, w: vbw, h: vbh };
    const where = L.pages > 1 ? `<div>Page ${n} of ${total}<br>Row ${iy + 1}, column ${ix + 1}</div>${pageMapSVG(L, ix, iy)}` : (total > 1 ? `<div>Page 1 of ${total}</div>` : '');
    pages.push(
      `<section class="print-page" style="width:${f(L.cw)}in;height:${f(L.ch)}in">` +
      `<div class="pp-head" style="height:${HEAD_H}in"><div class="pp-left"><div class="pp-title">${esc(S.title)}</div>` +
      `<div class="pp-sub">${esc(scaleText())}</div></div><div class="pp-scale">${scaleBarSVG(L)}</div><div class="pp-page">${where}</div></div>` +
      `<div class="pp-map${tiled ? ' tiled' : ''}" style="height:${f(L.mh)}in">` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vbx)} ${f(vby)} ${f(vbw)} ${f(vbh)}" style="width:${f(sw)}in;height:${f(sh)}in">${mapContentSVG(ro, vb, false)}</svg></div>` +
      legend + `</section>`);
  }
  if (S.print.refPage) pages.push(refPageHTML(L, ro, total));
  return { L, pages };
}
function refPageHTML(L, ro, total) {
  return `<section class="print-page ref-page" style="width:${f(L.cw)}in;height:${f(L.ch)}in">` +
    `<h1>${esc(S.title)} — key</h1>` +
    `<div>${scaleText()}. Map covers ${fmtNum(G.width / S.cellsPerMile)} × ${fmtNum(G.height / S.cellsPerMile)} miles (${S.cols} × ${S.rows} ${cellWord(true)}).</div>` +
    `<h2>Map symbols</h2>${legendSVG(L.cw, Object.assign({}, ro, { labels: true, icons: true }), 1.45)}` +
    `<h2>Reading the map</h2><ul>` +
    `<li><b>Highway:</b> solid double line. <b>Road / trail:</b> dashed line. Cells with neither are <b>trackless</b>.</li>` +
    `<li><b>River:</b> wavy line, through cells or along cell borders.</li>` +
    `<li><b>Cliff:</b> heavy line with teeth; the teeth point toward the <b>lower</b> ground.</li>` +
    (S.view.coords ? `<li><b>Cell numbers</b> are column.row, counted from the top-left.</li>` : '') +
    `</ul><h2>Overland movement (PHB Table 9–5)</h2>` +
    `<p style="margin:0 0 .06in;font-size:11pt">Multiply the party's normal overland speed by the factor for the terrain and route.</p>` +
    movementTableHTML('', '') +
    `<div style="margin-top:auto;font-size:9pt;text-align:right">Page ${total} of ${total}</div></section>`;
}

function readPrintInputs() {
  const P = S.print;
  P.mode = document.querySelector('input[name="pmode"]:checked').value;
  P.cellInches = parseFloat($('#p-cell').value) || 1;
  P.orientation = $('#p-orient').value;
  P.margin = parseFloat($('#p-margin').value) || 0.5;
  P.legend = $('#p-legend').value;
  P.refPage = $('#p-ref').checked;
  P.color = $('#p-color').checked;
  $('#p-cell').disabled = P.mode !== 'size';
  scheduleSave();
}
function syncPrintInputs() {
  const P = S.print;
  document.querySelectorAll('input[name="pmode"]').forEach(i => { i.checked = i.value === P.mode; });
  $('#p-cell').value = P.cellInches;
  $('#p-cell').disabled = P.mode !== 'size';
  $('#p-orient').value = P.orientation;
  $('#p-margin').value = P.margin;
  $('#p-legend').value = P.legend;
  $('#p-ref').checked = P.refPage;
  $('#p-color').checked = P.color;
}
let previewTimer = null;
function updatePrintPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const { L, pages } = buildPages();
    const mapPages = L.pages, word = cellWord(true);
    $('#p-summary').innerHTML =
      `${mapPages} map page${mapPages > 1 ? 's' : ''}${S.print.refPage ? ' + 1 key page' : ''}, ${L.o}.<br>` +
      `${word[0].toUpperCase() + word.slice(1)} print <b>${L.cellIn.toFixed(2)} in</b> across; 1 mile = ${(L.cellIn * S.cellsPerMile).toFixed(2)} in.` +
      (L.pages > 1 ? `<br>Pages are laid out ${L.px} across × ${L.py} down; trim and tape edge to edge.` : '') +
      (L.cellIn < 0.3 ? `<br>⚠ Cells are very small at this size. Consider fixed cell size with several pages.` : '');
    const LIMIT = 24;
    const shown = pages.slice(0, LIMIT).map(p => `<div class="paper" style="width:${L.pw}in;height:${L.ph}in;padding:${L.m}in">${p}</div>`).join('');
    $('#p-preview').innerHTML = shown + (pages.length > LIMIT ? `<div class="more">…and ${pages.length - LIMIT} more pages</div>` : '');
  }, 60);
}
function openPrintDialog() {
  syncPrintInputs();
  $('#print-dialog').showModal();
  updatePrintPreview();
}
function doPrint() {
  readPrintInputs();
  const { L, pages } = buildPages();
  $('#page-style').textContent = `@page { size: letter ${L.o}; margin: ${L.m}in; }`;
  $('#print-root').innerHTML = pages.join('');
  $('#print-dialog').close();
  setTimeout(() => window.print(), 80);
}
window.addEventListener('afterprint', () => { $('#print-root').innerHTML = ''; });

// ---------------------------------------------------------------- files
function saveFile() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.title || 'terrain-map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function openFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.cells) throw new Error('not a terrain map file');
      const before = snapshot();
      S = normalizeState(data);
      pushUndo(before);
      syncSettingsInputs();
      buildSidebar();
      renderAll();
      zoomFit();
      scheduleSave();
    } catch (err) {
      alert('Could not open that file: ' + err.message);
    }
  };
  reader.readAsText(file);
}
function newMap() {
  if (!confirm('Start a new, empty map? (You can undo this.) The size and scale settings are kept.')) return;
  const before = snapshot();
  S.cells = {}; S.edges = {}; S.roadLinks = {}; S.riverLinks = {}; S.title = 'Untitled overland map';
  pushUndo(before);
  renderAll();
  scheduleSave();
}

// ---------------------------------------------------------------- wiring
function wire() {
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('pointerleave', () => { if (!stroke && layers.hover) layers.hover.innerHTML = ''; });
  svg.addEventListener('contextmenu', e => e.preventDefault());
  $('#scroller').addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(ui.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e);
  }, { passive: false });

  $('#tool-buttons').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#brush-row').addEventListener('click', e => { const b = e.target.closest('[data-brush]'); if (b) { ui.brush = +b.dataset.brush; refreshToolUI(); } });
  $('#terrain-palette').addEventListener('click', e => {
    const b = e.target.closest('[data-terrain]');
    if (!b) return;
    ui.terrain = b.dataset.terrain;
    if (ui.tool !== 'fill') ui.tool = 'terrain';
    refreshToolUI();
  });
  $('#road-palette').addEventListener('click', e => {
    const b = e.target.closest('[data-road]');
    if (!b) return;
    ui.road = b.dataset.road;
    ui.tool = 'road';
    refreshToolUI();
  });
  document.querySelectorAll('[data-view]').forEach(cb => {
    cb.addEventListener('change', () => { S.view[cb.dataset.view] = cb.checked; renderAll(); scheduleSave(); });
  });

  document.querySelectorAll('input[name="gridType"]').forEach(i => i.addEventListener('change', updateSetupPreview));
  ['#set-width', '#set-height', '#set-cpm'].forEach(s => $(s).addEventListener('input', updateSetupPreview));
  $('#btn-apply').addEventListener('click', () => { applySetup(); buildSidebar(); });

  $('#map-title').addEventListener('change', e => {
    const before = snapshot();
    S.title = e.target.value.trim() || 'Untitled overland map';
    pushUndo(before);
    scheduleSave();
  });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-new').addEventListener('click', newMap);
  $('#btn-save').addEventListener('click', saveFile);
  $('#btn-open').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  $('#zoom-in').addEventListener('click', () => setZoom(ui.zoom * 1.25));
  $('#zoom-out').addEventListener('click', () => setZoom(ui.zoom / 1.25));
  $('#zoom-fit').addEventListener('click', zoomFit);

  $('#btn-print').addEventListener('click', openPrintDialog);
  const pd = $('#print-dialog');
  pd.addEventListener('input', () => { readPrintInputs(); updatePrintPreview(); });
  pd.addEventListener('change', () => { readPrintInputs(); updatePrintPreview(); });
  $('#p-go').addEventListener('click', e => { e.preventDefault(); doPrint(); });

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || pd.open;
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (k === 's') { e.preventDefault(); saveFile(); return; }
      if (k === 'p') { e.preventDefault(); openPrintDialog(); return; }
      return;
    }
    if (typing || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; $('#scroller').classList.add('panning'); } return; }
    if (/^[1-9]$/.test(e.key)) { ui.terrain = TERRAINS[+e.key - 1].id; if (ui.tool !== 'fill') ui.tool = 'terrain'; refreshToolUI(); return; }
    const map = { b: 'terrain', f: 'fill', r: 'road', e: 'erase' };
    if (map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); return; }
    if (e.key === '+' || e.key === '=') setZoom(ui.zoom * 1.25);
    if (e.key === '-') setZoom(ui.zoom / 1.25);
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ') { spaceDown = false; if (!pan) $('#scroller').classList.remove('panning'); }
  });
}

// ---------------------------------------------------------------- boot
installSymbols();
S = normalizeState(loadSaved());
G = makeGeom(S.gridType, S.cols, S.rows);
syncSettingsInputs();
buildSidebar();
wire();
renderAll();
updateUndoButtons();
requestAnimationFrame(zoomFit);
})();
