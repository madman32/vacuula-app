/**
 * Turns Vacuula run-length encoded maps into SVG path layers.
 * Floor values: 0 unknown, 1 free, 2 wall. Run maps carry one raw value per pass and 0 where
 * the robot did not drive. Zone vertices are fractions (0..1) of the map size.
 */
export interface RleMap {
  width: number;
  height: number;
  rle: [number, number][];
}

export interface PathLayer {
  color: string;
  d: string;
  opacity: number;
}

export interface RenderedMap {
  width: number;
  height: number;
  /** Cropped view box around everything known. */
  viewBox: { x: number; y: number; w: number; h: number };
  layers: PathLayer[];
}

const GOLDEN = 0.6180339887498949;
const MARGIN = 24;
export const FLOOR_COLOR = '#424e5a';
export const WALL_COLOR = '#e4e9ef';

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Deterministic colour per raw path value (same scheme as the web app). */
export function pathColor(value: number): string {
  return hslToHex((value * GOLDEN) % 1, 0.75, 0.55);
}

/** Group the runs of a row-major RLE list into per-value path strings. */
function runsToPaths(map: RleMap, accept: (v: number) => boolean, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const paths = new Map<number, string[]>();
  let pos = 0;
  const total = map.width * map.height;
  for (const [value, count] of map.rle) {
    let remaining = count;
    while (remaining > 0 && pos < total) {
      const x = pos % map.width;
      const y = Math.floor(pos / map.width);
      const len = Math.min(remaining, map.width - x, total - pos);
      if (value !== 0 && accept(value)) {
        let list = paths.get(value);
        if (!list) paths.set(value, (list = []));
        list.push(`M${x} ${y}h${len}v1h${-len}z`);
        if (x < bounds.minX) bounds.minX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (x + len > bounds.maxX) bounds.maxX = x + len;
        if (y + 1 > bounds.maxY) bounds.maxY = y + 1;
      }
      pos += len;
      remaining -= len;
    }
  }
  return paths;
}

export function renderMap(floor?: RleMap | null, run?: RleMap | null): RenderedMap {
  const base = floor ?? run;
  if (!base) throw new Error('Nothing to render');
  const width = Number(base.width), height = Number(base.height);
  const bounds = { minX: width, minY: height, maxX: 0, maxY: 0 };
  const layers: PathLayer[] = [];

  if (floor) {
    const paths = runsToPaths(floor, () => true, bounds);
    for (const [value, color] of [[1, FLOOR_COLOR], [2, WALL_COLOR]] as const) {
      const p = paths.get(value);
      if (p) layers.push({ color, d: p.join(''), opacity: 1 });
    }
  }
  if (run && Number(run.width) === width && Number(run.height) === height) {
    const paths = runsToPaths(run, () => true, bounds);
    for (const [value, p] of paths) layers.push({ color: pathColor(value), d: p.join(''), opacity: 0.75 });
  }

  const hasBounds = bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
  const x = hasBounds ? Math.max(0, bounds.minX - MARGIN) : 0;
  const y = hasBounds ? Math.max(0, bounds.minY - MARGIN) : 0;
  const w = (hasBounds ? Math.min(width, bounds.maxX + MARGIN) : width) - x;
  const h = (hasBounds ? Math.min(height, bounds.maxY + MARGIN) : height) - y;
  return { width, height, viewBox: { x, y, w, h }, layers };
}
