/**
 * Data models, state normalisation and robot command builders.
 * Pure TypeScript (no React / React Native) so it can be unit tested with plain Node.
 * Payload shapes mirror the Vacuula web app (app/src/http/gen3.ts and gen4.ts).
 */

export type Gen = 'neato.gen3' | 'neato.gen4';
export const GEN3: Gen = 'neato.gen3';
export const GEN4: Gen = 'neato.gen4';

export type Category = 'house' | 'map' | 'spot';
export const ZONE_KEY_SEP = '||:||';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export const GEN3_DAY_IDS: Record<Day, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const GEN3_DAY_NAMES: Record<number, Day> = Object.fromEntries(
  Object.entries(GEN3_DAY_IDS).map(([k, v]) => [v, k as Day]),
);

export const GEN3_CATEGORY_IDS: Record<Category, number> = { house: 2, spot: 3, map: 4 };
export const GEN3_MODE_IDS: Record<string, number> = { eco: 1, normal: 2 };
export const GEN3_NAV_IDS: Record<string, number> = { normal: 1, extra_care: 2, deep: 3 };
const GEN3_MODE_NAMES: Record<number, string> = { 1: 'eco', 2: 'normal' };
export const GEN4_MODES = ['eco', 'turbo'];
export const GEN4_MODES_D10 = ['eco', 'turbo', 'max', 'auto'];
export const GEN4_NAV_MODES = ['normal', 'gentle'];

// ---------------------------------------------------------------- state

export type RobotState =
  | 'idle' | 'cleaning' | 'docking' | 'paused' | 'error' | 'cleaning_standby' | 'updating'
  | 'test' | 'copying_logs' | 'recovering_location' | 'exploring_map'
  | 'acquiring_persistent_map_ids' | 'creating_uploading_map' | 'suspended_exploration' | 'unknown';

const GEN3_ACTIONS: Record<number, RobotState> = {
  1: 'cleaning', 2: 'cleaning', 3: 'cleaning', 4: 'docking', 5: 'test', 6: 'cleaning_standby',
  7: 'updating', 8: 'copying_logs', 9: 'recovering_location', 11: 'cleaning', 12: 'exploring_map',
  13: 'acquiring_persistent_map_ids', 14: 'creating_uploading_map', 15: 'suspended_exploration',
};
const GEN4_ACTIONS: Record<string, RobotState> = {
  docking: 'docking', cleaning: 'cleaning', cleaning_standby: 'cleaning_standby',
  diagnostic_test: 'test', updating_software: 'updating',
};

export function normalizeGen3State(state: unknown, action: unknown): RobotState {
  if (state === 4) return 'error';
  if (state === 3) return 'paused';
  if (state === 1) return 'idle';
  return GEN3_ACTIONS[action as number] ?? 'unknown';
}
export function normalizeGen4State(state: unknown, action: unknown): RobotState {
  if (state === 'error') return 'error';
  if (state === 'paused') return 'paused';
  if (state === 'idle') return 'idle';
  return GEN4_ACTIONS[action as string] ?? 'unknown';
}

export const STATE_LABELS: Record<RobotState, string> = {
  idle: 'Idle', cleaning: 'Cleaning', docking: 'Returning to base', paused: 'Paused', error: 'Error',
  cleaning_standby: 'Recharging mid-clean', updating: 'Updating', test: 'Testing', copying_logs: 'Copying logs',
  recovering_location: 'Recovering location', exploring_map: 'Exploring map',
  acquiring_persistent_map_ids: 'Acquiring map IDs', creating_uploading_map: 'Creating map',
  suspended_exploration: 'Exploration suspended', unknown: 'Unknown',
};

export const CLEANING_STATES = new Set<RobotState>([
  'cleaning', 'cleaning_standby', 'exploring_map', 'recovering_location',
  'acquiring_persistent_map_ids', 'creating_uploading_map', 'suspended_exploration',
]);

// ---------------------------------------------------------------- types

export interface MapInfo {
  id: string;
  name: string;
  enabled: boolean; // Gen3 enabled / Gen4 shown in maps list
  promoted: boolean; // Gen4 only
  raw: Record<string, any>;
}

export interface ZoneInfo {
  id: string;
  name: string;
  mapId: string;
  mapName: string;
  kind: 'zone' | 'nogo';
  shape: string;
  enabled: boolean;
  color?: string;
  vertices: [number, number][]; // 0..1 of the map
  key: string;
}

export interface ScheduleEvent {
  id: string;
  days: Day[];
  time: string; // HH:MM, server-local
  enabled: boolean;
  mode?: string;
  navigationMode?: string;
  mapId?: string;
  zoneIds: string[];
  nogoEnabled?: boolean;
  raw: Record<string, any>;
}

export interface RunSummary {
  id: string;
  started?: Date;
  ended?: Date;
  area?: number;
  batteryUsed?: number;
  startedBy?: string;
  complete?: boolean;
  status?: string;
  mapId?: string;
}

export interface CleaningPrefs {
  category: Category;
  mode: string;
  navigationMode: string;
  zoneKeys: string[];
  nogoEnabled: boolean;
  spotWidth: number;
  spotHeight: number;
}

export interface RobotData {
  serial: string;
  gen: Gen;
  name: string;
  connected: boolean;
  labelSerial?: string;
  state?: RobotState;
  battery?: number;
  isCharging?: boolean;
  isDocked?: boolean;
  canStart: boolean;
  canStop: boolean;
  canPause: boolean;
  canResume: boolean;
  canReturnToBase: boolean;
  errors: string[];
  alert?: string;
  model?: string;
  firmware?: string;
  scheduleEnabled?: boolean;
  maps: MapInfo[];
  zones: ZoneInfo[];
  schedule: ScheduleEvent[];
  gen3Preferences?: Record<string, any>;
  gen4CleaningOptions?: Record<string, any>;
  gen4Language?: Record<string, any>;
  runs: RunSummary[];
  boundaries: Record<string, any>[];
  prefs: CleaningPrefs;
}

export function newRobot(serial: string, row: { type: Gen; name?: string; connected?: boolean; label_serial?: string }): RobotData {
  return {
    serial, gen: row.type, name: row.name || serial, connected: !!row.connected, labelSerial: row.label_serial,
    canStart: false, canStop: false, canPause: false, canResume: false, canReturnToBase: false,
    errors: [], maps: [], zones: [], schedule: [], runs: [], boundaries: [],
    prefs: { category: 'house', mode: 'eco', navigationMode: 'normal', zoneKeys: [], nogoEnabled: true, spotWidth: 200, spotHeight: 200 },
  };
}

export const isGen3 = (r: RobotData) => r.gen === GEN3;
export const isGen4 = (r: RobotData) => r.gen === GEN4;
export const isD10 = (r: RobotData) => isGen4(r) && !!r.labelSerial && r.labelSerial.slice(4, 6) === 'N2';
export function cleaningModes(r: RobotData): string[] {
  return isGen3(r) ? Object.keys(GEN3_MODE_IDS) : isD10(r) ? GEN4_MODES_D10 : GEN4_MODES;
}
export const navigationModes = (r: RobotData) => (isGen3(r) ? Object.keys(GEN3_NAV_IDS) : GEN4_NAV_MODES);
export const promotedMap = (r: RobotData) => r.maps.find((m) => m.promoted);
export const enabledMaps = (r: RobotData) => r.maps.filter((m) => m.enabled);
export const cleaningZones = (r: RobotData) => r.zones.filter((z) => z.kind === 'zone');
export const zoneLabel = (r: RobotData, z: ZoneInfo) => (isGen3(r) ? `${z.mapName} - ${z.name}` : z.name);
export const isCleaning = (r: RobotData) => !!r.state && CLEANING_STATES.has(r.state);

// ---------------------------------------------------------------- state parsing

const intOrUndef = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseInt(v, 10) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : undefined;
};

export function applyGen3State(robot: RobotData, data: Record<string, any>): void {
  const details = data.details ?? {};
  const cmds = data.availableCommands ?? {};
  robot.state = normalizeGen3State(data.state, data.action);
  robot.battery = intOrUndef(details.charge);
  robot.isCharging = details.isCharging;
  robot.isDocked = details.isDocked;
  if (details.isScheduleEnabled !== undefined) robot.scheduleEnabled = details.isScheduleEnabled;
  robot.canStart = !!cmds.start;
  robot.canStop = !!cmds.stop;
  robot.canPause = !!cmds.pause;
  robot.canResume = !!cmds.resume;
  robot.canReturnToBase = !!cmds.goToBase;
  robot.errors = data.error ? [String(data.error)] : [];
  robot.alert = data.alert || undefined;
  const meta = data.meta ?? {};
  if (meta.modelName) robot.model = meta.modelName;
  if (meta.firmware) robot.firmware = meta.firmware;
}

export function applyGen4State(robot: RobotData, body: Record<string, any>): void {
  const details = body.details ?? {};
  const cmds = body.available_commands ?? {};
  robot.state = normalizeGen4State(body.state, body.action);
  robot.battery = intOrUndef(details.charge);
  robot.isCharging = details.is_charging;
  robot.isDocked = details.is_docked;
  robot.canStart = !!cmds.start;
  robot.canStop = !!cmds.cancel;
  robot.canPause = !!cmds.pause;
  robot.canResume = !!cmds.resume;
  robot.canReturnToBase = !!cmds.return_to_base;
  robot.errors = (body.errors ?? []).filter((e: any) => e && e.code).map((e: any) => String(e.code));
  robot.alert = undefined;
}

/** Apply a per-robot SSE message; returns true when the state changed. */
export function parseRobotEvent(robot: RobotData, message: Record<string, any>): boolean {
  if (message.type === GEN4) {
    const ev = message.data ?? {};
    if (ev.to?.service === 'peer.state' && ev.body && typeof ev.body === 'object') {
      applyGen4State(robot, ev.body);
      return true;
    }
    return false;
  }
  const ev = message.data ?? {};
  if (ev.type === 'state' || ev.eventId === '77') {
    if (ev.data && typeof ev.data === 'object') {
      applyGen3State(robot, ev.data);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- maps / zones / runs

export function parseMaps(gen: Gen, rows: Record<string, any>[]): MapInfo[] {
  return rows
    .filter((r) => r && r.id !== undefined)
    .map((r) =>
      gen === GEN3
        ? { id: String(r.id), name: r.name || String(r.id), enabled: !!r.enabled, promoted: false, raw: r }
        : { id: String(r.id), name: r.name || String(r.id), enabled: r.in_maps_list ?? true, promoted: !!r.promoted, raw: r },
    );
}

export function parseZones(map: MapInfo, boundaries: Record<string, any>[]): ZoneInfo[] {
  const zones: ZoneInfo[] = [];
  for (const b of boundaries) {
    if (!b || b.id === undefined) continue;
    const shape = b.type || 'polygon';
    const kind: 'zone' | 'nogo' =
      b.function === undefined || b.function === null
        ? shape === 'polygon' ? 'zone' : 'nogo'
        : b.function === 'cleaning' && shape === 'polygon' ? 'zone' : 'nogo';
    zones.push({
      id: String(b.id), name: b.name || String(b.id), mapId: map.id, mapName: map.name, kind, shape,
      enabled: b.enabled ?? true, color: b.color,
      vertices: (b.vertices ?? []).filter((v: any) => Array.isArray(v) && v.length >= 2).map((v: any) => [Number(v[0]), Number(v[1])]),
      key: `${map.id}${ZONE_KEY_SEP}${b.id}`,
    });
  }
  return zones;
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  let d = new Date(value);
  if (isNaN(d.getTime())) {
    const m = value.match(/^(\d{4})-(\d\d)-(\d\d)[_ ](\d\d)-?:?(\d\d)-?:?(\d\d)$/);
    if (!m) return undefined;
    d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  } else if (!/[zZ]|[+-]\d\d:?\d\d$/.test(value)) {
    d = new Date(value + 'Z'); // naive timestamps are UTC
  }
  return isNaN(d.getTime()) ? undefined : d;
}

export function parseRun(gen: Gen, item: Record<string, any>): RunSummary | undefined {
  if (item.id === undefined) return undefined;
  if (gen === GEN3) {
    const run = item.run ?? {};
    const cs = run.run_charge_at_start, ce = run.run_charge_at_end;
    return {
      id: String(item.id), started: parseDate(run.start_at), ended: parseDate(run.end_at),
      area: typeof run.cleaned_area === 'number' ? run.cleaned_area : undefined,
      batteryUsed: typeof cs === 'number' && typeof ce === 'number' ? Math.trunc(cs - ce) : undefined,
      startedBy: run.launched_from, status: run.status,
      mapId: item.persistent_map ? String(item.persistent_map) : undefined,
    };
  }
  const timing = item.timing ?? {};
  const areas = (item.runs ?? []).map((r: any) => r?.stats?.area).filter((a: any) => typeof a === 'number');
  return {
    id: String(item.id), started: parseDate(timing.start), ended: parseDate(timing.end),
    area: areas.length ? areas.reduce((a: number, b: number) => a + b, 0) : undefined,
    batteryUsed: intOrUndef(item.battery_consumed), startedBy: item.started_by, complete: item.cleaning_complete,
    mapId: String(item.floorplan || item.id),
  };
}

export function parseRuns(gen: Gen, rows: Record<string, any>[], limit = 20): RunSummary[] {
  const runs = rows.map((r) => parseRun(gen, r)).filter((r): r is RunSummary => !!r);
  runs.sort((a, b) => (b.started?.getTime() ?? 0) - (a.started?.getTime() ?? 0));
  return runs.slice(0, limit);
}

export const runDurationMinutes = (r: RunSummary) =>
  r.started && r.ended ? Math.round((r.ended.getTime() - r.started.getTime()) / 60000) : undefined;

// ---------------------------------------------------------------- schedules

/** Shift a weekly slot (Sunday = 0) by deltaMinutes, moving the day on wrap. */
export function shiftSlot(day: number, time: string, deltaMinutes: number): [number, string] {
  const [h, m] = time.split(':').map((p) => parseInt(p, 10));
  const total = h * 60 + m + deltaMinutes;
  const dayShift = Math.floor(total / 1440);
  const minutes = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return [(((day + dayShift) % 7) + 7) % 7, `${hh}:${mm}`];
}

export function parseGen3Schedule(data: Record<string, any>, utcOffsetMinutes: number): [boolean, ScheduleEvent[]] {
  const events: ScheduleEvent[] = [];
  for (const raw of data.events ?? []) {
    if (raw?.day === undefined || !raw.startTime) continue;
    const [day, time] = shiftSlot(Number(raw.day), raw.startTime, utcOffsetMinutes);
    const dayName = GEN3_DAY_NAMES[day] ?? 'mon';
    const boundaryId = raw.boundaryId ?? raw.boundary?.id;
    events.push({
      id: `${dayName}-${time}${boundaryId ? `-${boundaryId}` : ''}`,
      days: [dayName], time, enabled: true, mode: GEN3_MODE_NAMES[raw.mode],
      zoneIds: boundaryId ? [String(boundaryId)] : [], raw,
    });
  }
  return [!!data.enabled, events];
}

export function parseGen4Schedule(body: Record<string, any>): [boolean, ScheduleEvent[]] {
  const events: ScheduleEvent[] = [];
  for (const raw of body.events ?? []) {
    if (!raw || !raw.id) continue;
    const runs: any[] = raw.command?.runs ?? [];
    const settings = runs[0]?.settings ?? {};
    const maps = runs.map((r) => r?.map).filter(Boolean);
    events.push({
      id: String(raw.id), days: raw.days ?? [], time: raw.time ?? '00:00', enabled: raw.enabled ?? true,
      mode: settings.mode, navigationMode: settings.navigation_mode, mapId: maps[0]?.rank_id,
      zoneIds: maps.map((m) => m.track_id).filter(Boolean), nogoEnabled: maps[0]?.nogo_enabled, raw,
    });
  }
  return [!!body.enabled, events];
}

/** Next occurrence of any enabled event. `now` and event times are interpreted in server-local wall time. */
export function nextScheduledRun(events: ScheduleEvent[], utcOffsetMinutes: number, now: Date = new Date()): Date | undefined {
  // Work in "server wall clock" expressed as a UTC-based Date.
  const wall = new Date(now.getTime() + utcOffsetMinutes * 60000);
  let best: number | undefined;
  for (const e of events) {
    if (!e.enabled) continue;
    const [h, m] = e.time.split(':').map((p) => parseInt(p, 10));
    for (const d of e.days) {
      const idx = DAYS.indexOf(d);
      if (idx < 0) continue;
      const wallWeekday = (wall.getUTCDay() + 6) % 7; // Monday = 0
      const ahead = (idx - wallWeekday + 7) % 7;
      let cand = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + ahead, h, m);
      if (cand <= wall.getTime()) cand += 7 * 86400000;
      if (best === undefined || cand < best) best = cand;
    }
  }
  return best === undefined ? undefined : new Date(best - utcOffsetMinutes * 60000);
}

// ---------------------------------------------------------------- command payloads

export const gen3Cmd = (cmd: string, params?: Record<string, any>) => (params ? { cmd, params } : { cmd });
export const gen4Cmd = (ability: string, fields: Record<string, any> = {}) => ({ ability, ...fields });

export interface StartRequest {
  category: Category;
  mode: string;
  navigationMode: string;
  zoneKeys: string[];
  nogoEnabled: boolean;
  spotWidth: number;
  spotHeight: number;
}

export class StartError extends Error {}

export function buildStartCommand(robot: RobotData, req: StartRequest): Record<string, any> {
  if (isGen3(robot)) {
    const mode = GEN3_MODE_IDS[req.mode];
    const nav = GEN3_NAV_IDS[req.navigationMode];
    if (req.category === 'spot') {
      return gen3Cmd('startCleaning', {
        category: GEN3_CATEGORY_IDS.spot, mode, navigationMode: nav,
        spotHeight: req.spotHeight, spotWidth: req.spotWidth,
      });
    }
    let category = req.category;
    if (category === 'map') {
      if (!robot.isDocked) throw new StartError('Map and zone cleaning needs the robot to be docked');
      if (!enabledMaps(robot).length) category = 'house'; // same fallback as the web app
    }
    if (category === 'map' && req.zoneKeys.length) {
      if (req.zoneKeys.length > 1) throw new StartError('Gen3 robots can only clean one zone at a time');
      const [mapId, zoneId] = req.zoneKeys[0].split(ZONE_KEY_SEP);
      return gen3Cmd('startCleaning', {
        category: GEN3_CATEGORY_IDS.map, mode, navigationMode: nav, mapId, boundaryId: zoneId,
      });
    }
    return gen3Cmd('startCleaning', { category: GEN3_CATEGORY_IDS[category], mode, navigationMode: nav });
  }

  const settings = { mode: req.mode, navigation_mode: req.navigationMode };
  const promoted = promotedMap(robot);
  let runs: Record<string, any>[];
  if (req.category !== 'map' || !promoted) {
    runs = [{ map: null, settings }];
  } else {
    if (!robot.isDocked) throw new StartError('Map and zone cleaning needs the robot to be docked');
    const zoneIds: (string | null)[] = req.zoneKeys.map((k) => k.split(ZONE_KEY_SEP)[1] || k);
    if (!zoneIds.length) zoneIds.push(null);
    runs = zoneIds.map((z) => ({ map: { rank_id: promoted.id, track_id: z, nogo_enabled: req.nogoEnabled }, settings }));
  }
  return gen4Cmd('cleaning.start', { runs });
}

export function gen4ScheduleRuns(
  robot: RobotData,
  o: { mode: string; navigationMode: string; useMap: boolean; zoneIds: string[]; nogoEnabled: boolean },
): Record<string, any>[] {
  const settings = { mode: o.mode, navigation_mode: o.navigationMode };
  const promoted = promotedMap(robot);
  if (!o.useMap || !promoted) return [{ map: null, settings }];
  const ids: (string | null)[] = o.zoneIds.length ? o.zoneIds : [null];
  return ids.map((z) => ({ map: { rank_id: promoted.id, track_id: z, nogo_enabled: o.nogoEnabled }, settings }));
}

// ---------------------------------------------------------------- misc helpers

export function formatNavMode(m: string): string {
  return m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
