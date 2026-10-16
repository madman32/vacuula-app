import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { VacuulaClient, VacuulaCommandError, SSEParser } from '../client';
import { VacuulaStore } from '../store';
import { nextScheduledRun, shiftSlot } from '../models';

const PORT = 18731;
let proc: ChildProcess;

beforeAll(async () => {
  // needs python3 with aiohttp (set FAKE_PY to pick the interpreter)
  proc = spawn(process.env.FAKE_PY ?? 'python3', [path.join(__dirname, '../../../test-server/run_fake.py'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((res, rej) => {
    proc.stdout!.on('data', (d) => String(d).includes('READY') && res());
    proc.on('exit', () => rej(new Error('fake server exited')));
  });
});
afterAll(() => proc.kill());

const G3 = 'OPS01234-0123456789AB';
const G4 = 'g4robot0001';
const wait = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout waiting for condition');
};

test('sse parser handles chunk splits, comments and multi-line data', () => {
  const p = new SSEParser();
  const out = [...p.push(': keepalive\n\nevent: robots\nda'), ...p.push('ta: {"a":1}\ndata: x\n\n'), ...p.push('data: y\r\n\r\n')];
  expect(out).toEqual([{ event: 'robots', data: '{"a":1}\nx' }, { event: undefined, data: 'y' }]);
});

test('shiftSlot / nextScheduledRun', () => {
  expect(shiftSlot(0, '23:30', 60)).toEqual([1, '00:30']);
  expect(shiftSlot(0, '00:30', -60)).toEqual([6, '23:30']);
  const ev: any = { enabled: true, days: ['thu'], time: '18:30' };
  // Thu 2026-10-15 11:44Z, Stockholm UTC+2 -> 18:30 local = 16:30Z same day
  expect(nextScheduledRun([ev], 120, new Date('2026-10-15T11:44:00Z'))!.toISOString()).toBe('2026-10-15T16:30:00.000Z');
  expect(nextScheduledRun([ev], 120, new Date('2026-10-15T17:00:00Z'))!.toISOString()).toBe('2026-10-22T16:30:00.000Z');
});

test('client: server info, bare OK bodies, command errors', async () => {
  const c = new VacuulaClient('127.0.0.1', PORT);
  expect((await c.getServerInfo()).utc_offset_minutes).toBe(120);
  expect(await c.setRobotName(G3, 'Downstairs')).toBe('OK');
  await expect(c.command('nope', { cmd: 'x' })).rejects.toBeInstanceOf(VacuulaCommandError);
  await expect(new VacuulaClient('127.0.0.1', 1).getServerInfo()).rejects.toThrow(/Cannot reach/);
});

test('store: loads both robots, runs commands, receives pushes', async () => {
  const store = new VacuulaStore(new VacuulaClient('127.0.0.1', PORT));
  await store.connect();
  try {
    const snap = store.getSnapshot();
    expect(snap.status).toBe('online');
    expect(snap.robots.map((r) => r.name).sort()).toEqual(['Downstairs', 'Upstairs']);
    const g3 = store.get(G3), g4 = store.get(G4);
    expect(g3.battery).toBe(96);
    expect(g3.isDocked).toBe(true);
    expect(g3.zones.map((z) => z.name)).toContain('Kitchen');
    expect(g4.zones.find((z) => z.name === 'Cables')!.kind).toBe('nogo');
    expect(g4.maps[0].promoted).toBe(true);
    expect(g3.schedule[0]).toMatchObject({ days: ['mon'], time: '09:00' }); // 07:00 UTC -> 09:00 local
    expect(g4.schedule[0]).toMatchObject({ id: 'evt-1', days: ['tue', 'thu'], time: '18:30' });
    expect(g3.runs[0].area).toBe(42.5);
    expect(g4.runs[0].area).toBe(31.5);

    // start/pause/dock with pushed state
    await store.startOrResume(G3);
    await wait(() => store.get(G3).state === 'cleaning');
    await store.pause(G3);
    await wait(() => store.get(G3).state === 'paused');
    expect(store.get(G3).canResume).toBe(true);
    await store.returnToBase(G3);
    await wait(() => store.get(G3).state === 'docking');

    // gen4 zone cleaning builds the right command
    store.setPrefs(G4, { category: 'map', mode: 'turbo', zoneKeys: [g4.zones.find((z) => z.name === 'Bedroom')!.key] });
    await store.startCleaning(G4);
    expect(store.get(G4).state).toBe('cleaning');

    // schedule: gen3 add shifts to UTC; gen4 add/remove
    await store.addScheduleEvent(G3, { days: ['wed'], time: '01:00' });
    expect(store.get(G3).schedule.some((e) => e.days[0] === 'wed' && e.time === '01:00')).toBe(true);
    await store.addScheduleEvent(G4, { days: ['mon'], time: '09:00' });
    expect(store.get(G4).schedule).toHaveLength(2);
    await store.removeScheduleEvent(G4, 'evt-1');
    expect(store.get(G4).schedule.map((e) => e.id)).toEqual(['evt-2']);
    await store.setScheduleEventEnabled(G4, 'evt-2', false);
    expect(store.get(G4).schedule[0].enabled).toBe(false);
    await store.setScheduleEnabled(G3, false);
    expect(store.get(G3).scheduleEnabled).toBe(false);

    // map + run map data
    const map = await store.floorMap(G3, store.get(G3).maps[0].id);
    expect(map.width).toBe(40);

    // gen4 settings
    await store.setGen4Setting(G4, 'cleaning_options', { force_floorplan: true });
    expect(store.get(G4).gen4CleaningOptions).toEqual({ force_floorplan: true });

    // connectivity push
    const gen4 = store.get(G4);
    expect(gen4.connected).toBe(true);
  } finally {
    store.shutdown();
  }
});
