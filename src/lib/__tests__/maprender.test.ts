import { pathColor, renderMap } from '../maprender';

test('renders floor and run layers with a cropped viewbox', () => {
  const floor = { width: 10, height: 4, rle: [[0, 11], [1, 5], [2, 1], [0, 23]] as [number, number][] };
  const run = { width: 10, height: 4, rle: [[0, 12], [7, 3], [0, 25]] as [number, number][] };
  const r = renderMap(floor, run);
  expect(r.layers.map((l) => l.opacity)).toEqual([1, 1, 0.75]);
  // 11 zeros => first free cell at x=1,y=1 ; 5 cells run to x=6
  expect(r.layers[0].d).toBe('M1 1h5v1h-5z');
  expect(r.layers[1].d).toBe('M6 1h1v1h-1z');
  expect(r.layers[2].d).toBe('M2 1h3v1h-3z');
  expect(r.viewBox).toEqual({ x: 0, y: 0, w: 10, h: 4 });
});

test('wraps runs across rows', () => {
  const r = renderMap({ width: 4, height: 2, rle: [[1, 6], [0, 2]] });
  expect(r.layers[0].d).toBe('M0 0h4v1h-4zM0 1h2v1h-2z');
});

test('path colours are valid and distinct', () => {
  expect(pathColor(7)).toMatch(/^#[0-9a-f]{6}$/);
  expect(pathColor(7)).not.toBe(pathColor(9));
});
