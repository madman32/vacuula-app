/**
 * Zone / no-go editing helpers (pure, unit tested).
 * Vertices are fractions (0..1) of the map's width / height, exactly like the Vacuula web app stores them.
 */
import { Gen, GEN3, GEN4 } from './models';

export type Point = [number, number];
export type ZoneKind = 'cleaning' | 'nogo-zone' | 'nogo-line';

export interface Boundary {
  id: string;
  name: string;
  color: string;
  type: 'polygon' | 'polyline';
  vertices: Point[];
  enabled: boolean;
  function?: 'cleaning' | 'nogo';
  relevancy?: Point; // Gen3 polygons
  [extra: string]: unknown;
}

/** Same presets as the web app. */
export const BOUNDARY_PRESETS = [
  '#ff7a45', '#f5b942', '#b4e04a', '#3ddc97', '#38d0e0', '#5aa9ff', '#a78bfa', '#e879f9', '#fb7185', '#f97373',
];

export function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export function pickUnusedPreset(used: (string | undefined)[]): string {
  const taken = new Set(used.map(normalizeHex).filter(Boolean));
  return BOUNDARY_PRESETS.find((p) => !taken.has(p)) ?? BOUNDARY_PRESETS[used.length % BOUNDARY_PRESETS.length];
}

/** Kinds a robot generation can draw. Gen3 polygons are always cleaning zones; Gen4 can also have no-go zones. */
export function availableKinds(gen: Gen): ZoneKind[] {
  return gen === GEN4 ? ['cleaning', 'nogo-zone', 'nogo-line'] : ['cleaning', 'nogo-line'];
}

export const KIND_LABELS: Record<ZoneKind, string> = {
  cleaning: 'Cleaning zone', 'nogo-zone': 'No-go zone', 'nogo-line': 'No-go line',
};

export const isClosed = (kind: ZoneKind) => kind !== 'nogo-line';
export const minVertices = (kind: ZoneKind) => (isClosed(kind) ? 3 : 2);

export function kindOf(b: Pick<Boundary, 'type' | 'function'>): ZoneKind {
  if (b.type === 'polyline') return 'nogo-line';
  return b.function === 'nogo' ? 'nogo-zone' : 'cleaning';
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const centroid = (v: Point[]): Point => [
  v.reduce((s, p) => s + p[0], 0) / v.length,
  v.reduce((s, p) => s + p[1], 0) / v.length,
];

// ---- geometry

function ccw(a: Point, b: Point, c: Point) {
  return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when no two non-adjacent edges cross (robots reject self-intersecting zones). */
export function isSimplePolygon(v: Point[]): boolean {
  const n = v.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsCross(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function polygonArea(v: Point[]): number {
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// ---- view transform

export interface ViewWindow { x: number; y: number; w: number; h: number } // in map cells

/** Touch position (pixels in a view of size viewW x viewH) -> fractional map coordinates. */
export function screenToMap(px: number, py: number, viewW: number, viewH: number, win: ViewWindow, mapW: number, mapH: number): Point {
  const cellX = win.x + (px / viewW) * win.w;
  const cellY = win.y + (py / viewH) * win.h;
  return [clamp01(cellX / mapW), clamp01(cellY / mapH)];
}

export function mapToScreen(p: Point, viewW: number, viewH: number, win: ViewWindow, mapW: number, mapH: number): [number, number] {
  return [((p[0] * mapW - win.x) / win.w) * viewW, ((p[1] * mapH - win.y) / win.h) * viewH];
}

/** Index of the vertex within `radius` pixels of a touch, nearest first, or -1. */
export function hitVertex(
  vertices: Point[], px: number, py: number, radius: number, viewW: number, viewH: number, win: ViewWindow, mapW: number, mapH: number,
): number {
  let best = -1, bestD = radius;
  vertices.forEach((v, i) => {
    const [sx, sy] = mapToScreen(v, viewW, viewH, win, mapW, mapH);
    const d = Math.hypot(sx - px, sy - py);
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

/** Window showing `zoom`x magnification centred on (cx, cy) (cells), kept inside `bounds`. */
export function zoomWindow(bounds: ViewWindow, zoom: number, cx: number, cy: number): ViewWindow {
  const w = bounds.w / zoom, h = bounds.h / zoom;
  const x = Math.min(bounds.x + bounds.w - w, Math.max(bounds.x, cx - w / 2));
  const y = Math.min(bounds.y + bounds.h - h, Math.max(bounds.y, cy - h / 2));
  return { x, y, w, h };
}

// ---- building / saving

export class ZoneError extends Error {}

export function newId(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

export function buildBoundary(o: {
  id?: string; name: string; color: string; kind: ZoneKind; vertices: Point[]; enabled?: boolean; gen: Gen; existingCount: number;
}): Boundary {
  if (!availableKinds(o.gen).includes(o.kind)) throw new ZoneError(`${KIND_LABELS[o.kind]} is not available on this robot.`);
  const need = minVertices(o.kind);
  if (o.vertices.length < need) {
    throw new ZoneError(isClosed(o.kind) ? 'A zone needs at least 3 corners.' : 'A line needs at least 2 points.');
  }
  if (isClosed(o.kind)) {
    if (!isSimplePolygon(o.vertices)) throw new ZoneError('The outline crosses itself. Move a corner so the edges don’t cross.');
    if (polygonArea(o.vertices) < 1e-5) throw new ZoneError('That zone is too small.');
  }
  const closed = isClosed(o.kind);
  const b: Boundary = {
    id: o.id ?? newId(),
    name: o.name.trim() || `${KIND_LABELS[o.kind]} ${o.existingCount + 1}`,
    color: normalizeHex(o.color) ?? BOUNDARY_PRESETS[0],
    type: closed ? 'polygon' : 'polyline',
    vertices: o.vertices.map((p) => [clamp01(p[0]), clamp01(p[1])] as Point),
    enabled: o.enabled ?? true,
    function: o.kind === 'nogo-zone' || o.kind === 'nogo-line' ? 'nogo' : 'cleaning',
  };
  return b;
}

/** Replace a boundary with the same id (keeping order) or append it. */
export function upsertBoundary(list: Boundary[], b: Boundary): Boundary[] {
  const i = list.findIndex((x) => x.id === b.id);
  if (i < 0) return [...list, b];
  const copy = [...list];
  copy[i] = { ...list[i], ...b };
  return copy;
}

/**
 * Wire format. Gen4 (server) requires exactly these seven keys. Gen3 (sent to the robot) additionally gets a
 * `relevancy` point for polygons — the same payload the Vacuula web app sends.
 */
export function serializeBoundaries(gen: Gen, list: Boundary[]): Record<string, unknown>[] {
  return list.map((b) => {
    const base: Record<string, unknown> = {
      id: b.id, name: b.name, color: b.color, type: b.type, vertices: b.vertices, enabled: b.enabled,
    };
    if (gen === GEN4) {
      base.function = b.function ?? (b.type === 'polygon' ? 'cleaning' : 'nogo');
    } else {
      // Gen3 boundaries read back from the robot have no `function`; keep them as they were
      if (b.function) base.function = b.function;
      if (b.type === 'polygon') base.relevancy = centroid(b.vertices);
    }
    return base;
  });
}
