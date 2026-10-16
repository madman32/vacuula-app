/**
 * Framework-free state container: keeps a live view of one Vacuula server and its robots.
 * Live state arrives over the server's SSE streams; a 60 s poll is the safety net and
 * maps / zones / schedule / settings / history refresh every 5 minutes.
 */
import {
  VacuulaClient, VacuulaError, SSEMessage,
} from './client';
import {
  Category, DAYS, RunSummary, Day, GEN3_DAY_IDS, GEN3_MODE_IDS, GEN3_NAV_IDS, GEN4_NAV_MODES, MapInfo, RobotData, StartRequest, ZoneInfo,
  applyGen3State, applyGen4State, buildStartCommand, cleaningModes, cleaningZones, gen3Cmd, gen4Cmd, gen4ScheduleRuns,
  isGen3, isGen4, newRobot, parseGen3Schedule, parseGen4Schedule, parseMaps, parseRobotEvent, parseRuns, parseZones,
  promotedMap, shiftSlot, StartError, ZONE_KEY_SEP, enabledMaps, nextScheduledRun,
} from './models';
import { Boundary, serializeBoundaries, upsertBoundary } from './zones';

export class ActionError extends Error {}

export interface Snapshot {
  version: number;
  status: 'connecting' | 'online' | 'offline';
  error?: string;
  server?: { version: string; timezone?: string; utcOffsetMinutes: number };
  robots: RobotData[];
}

export interface StartOverrides {
  category?: Category;
  cleaningMode?: string;
  navigationMode?: string;
  zones?: string[];
  nogoEnabled?: boolean;
  spotWidth?: number;
  spotHeight?: number;
}

const POLL_MS = 60_000;
const SLOW_MS = 5 * 60_000;
const RETURN_TO_BASE_PAUSE_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VacuulaStore {
  private robots = new Map<string, RobotData>();
  private listeners = new Set<() => void>();
  private snap: Snapshot = { version: 0, status: 'connecting', robots: [] };
  private abort?: AbortController;
  private robotAborts = new Map<string, AbortController>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private slowAt = new Map<string, number>();
  private mapCache = new Map<string, any>();
  utcOffsetMinutes = 0;
  timezone?: string;
  serverVersion?: string;
  private status: Snapshot['status'] = 'connecting';
  private error?: string;

  constructor(public client: VacuulaClient) {}

  // ---- external-store plumbing
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private emit() {
    this.snap = {
      version: this.snap.version + 1,
      status: this.status,
      error: this.error,
      server: this.serverVersion
        ? { version: this.serverVersion, timezone: this.timezone, utcOffsetMinutes: this.utcOffsetMinutes }
        : undefined,
      robots: [...this.robots.values()],
    };
    this.listeners.forEach((l) => l());
  }

  get(serial: string): RobotData {
    const r = this.robots.get(serial);
    if (!r) throw new ActionError('Unknown robot');
    return r;
  }
  nextScheduled(robot: RobotData) {
    return nextScheduledRun(robot.schedule, this.utcOffsetMinutes);
  }

  // ---- lifecycle
  async connect(): Promise<void> {
    this.abort = new AbortController();
    this.status = 'connecting';
    this.emit();
    try {
      await this.loadServer();
      await this.refreshAll(true);
    } catch (err) {
      this.status = 'offline';
      this.error = (err as Error).message;
      this.emit();
    }
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    void this.serverEventsLoop(this.abort.signal);
    for (const serial of this.robots.keys()) this.ensureRobotListener(serial);
  }

  shutdown(): void {
    this.abort?.abort();
    this.robotAborts.forEach((a) => a.abort());
    this.robotAborts.clear();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async loadServer() {
    const info = await this.client.getServerInfo();
    this.serverVersion = String(info.version);
    this.timezone = info.timezone;
    this.utcOffsetMinutes = Number(info.utc_offset_minutes ?? 0);
    this.applyRobots(await this.client.getRobots());
    this.status = 'online';
    this.error = undefined;
  }

  private async poll() {
    try {
      if (this.status !== 'online') await this.loadServer();
      else this.applyRobots(await this.client.getRobots());
      await this.refreshAll(false);
    } catch (err) {
      this.status = 'offline';
      this.error = (err as Error).message;
      this.emit();
    }
  }

  async refreshAll(forceSlow: boolean): Promise<void> {
    await Promise.all(
      [...this.robots.values()].map(async (r) => {
        const slow = forceSlow || Date.now() - (this.slowAt.get(r.serial) ?? 0) > SLOW_MS;
        await this.refreshRobot(r, slow, false);
      }),
    );
    this.emit();
  }

  async refreshRobot(robot: RobotData, slow: boolean, emit = true): Promise<void> {
    if (robot.connected) {
      try {
        if (isGen3(robot)) {
          const resp = await this.client.command(robot.serial, gen3Cmd('getRobotState'));
          if (resp && typeof resp === 'object') applyGen3State(robot, resp);
        } else {
          const resp = await this.client.command(robot.serial, gen4Cmd('state.show'));
          if (resp?.body && typeof resp.body === 'object') applyGen4State(robot, resp.body);
        }
      } catch {
        /* keep last known state */
      }
    }
    if (slow) await this.fetchSlow(robot);
    if (emit) this.emit();
  }

  /** Pull-to-refresh entry point. */
  async refreshAllNow() {
    try {
      await this.loadServer();
    } catch (err) {
      this.status = 'offline';
      this.error = (err as Error).message;
      this.emit();
      return;
    }
    await this.refreshAll(true);
  }

  private async fetchSlow(robot: RobotData) {
    const serial = robot.serial;
    this.slowAt.set(serial, Date.now());
    try { robot.maps = parseMaps(robot.gen, await this.client.getMaps(serial)); } catch { /* keep */ }
    await this.fetchZones(robot);
    try { robot.runs = parseRuns(robot.gen, await this.client.getRuns(serial)); } catch { /* keep */ }
    if (!robot.connected) return;
    try { await this.fetchSchedule(robot); } catch { /* keep */ }
    try { await this.fetchSettings(robot); } catch { /* keep */ }
  }

  private async fetchZones(robot: RobotData) {
    const zones: ZoneInfo[] = [];
    try {
      if (isGen4(robot)) {
        const promoted = promotedMap(robot);
        if (promoted) {
          robot.boundaries = await this.client.getBoundaries(robot.serial, promoted.id);
          zones.push(...parseZones(promoted, robot.boundaries));
        } else robot.boundaries = [];
      } else {
        if (!robot.connected) return; // Gen3 boundaries live on the robot
        for (const m of enabledMaps(robot)) {
          const resp = await this.client.command(robot.serial, gen3Cmd('getMapBoundaries', { mapId: m.id }));
          zones.push(...parseZones(m, resp?.data?.boundaries ?? []));
        }
      }
    } catch {
      return;
    }
    robot.zones = zones;
    const valid = new Set(cleaningZones(robot).map((z) => z.key));
    robot.prefs.zoneKeys = robot.prefs.zoneKeys.filter((k) => valid.has(k));
  }

  private async fetchSchedule(robot: RobotData) {
    if (isGen3(robot)) {
      const resp = await this.client.command(robot.serial, gen3Cmd('getSchedule'));
      const [enabled, events] = parseGen3Schedule(resp?.data ?? {}, this.utcOffsetMinutes);
      robot.scheduleEnabled = enabled;
      robot.schedule = events;
    } else {
      const resp = await this.client.command(robot.serial, gen4Cmd('scheduling.show'));
      const [enabled, events] = parseGen4Schedule(resp?.body ?? {});
      robot.scheduleEnabled = enabled;
      robot.schedule = events;
    }
  }

  private async fetchSettings(robot: RobotData) {
    if (isGen3(robot)) {
      const resp = await this.client.command(robot.serial, gen3Cmd('getPreferences'));
      if (resp?.data && typeof resp.data === 'object') robot.gen3Preferences = resp.data;
    } else {
      let resp = await this.client.command(robot.serial, gen4Cmd('settings.cleaning_options'));
      if (resp?.body && typeof resp.body === 'object') robot.gen4CleaningOptions = resp.body;
      resp = await this.client.command(robot.serial, gen4Cmd('settings.robot_language'));
      if (resp?.body && typeof resp.body === 'object') robot.gen4Language = resp.body;
    }
  }

  // ---- robot bookkeeping / push

  private applyRobots(snapshot: Record<string, any>) {
    const newlyConnected: string[] = [];
    for (const [serial, row] of Object.entries(snapshot)) {
      const existing = this.robots.get(serial);
      if (!existing) {
        this.robots.set(serial, newRobot(serial, row as any));
        newlyConnected.push(serial);
      } else {
        const was = existing.connected;
        existing.name = (row as any).name || existing.name;
        existing.connected = !!(row as any).connected;
        existing.labelSerial = (row as any).label_serial ?? existing.labelSerial;
        if (!was && existing.connected) newlyConnected.push(serial);
      }
    }
    for (const serial of [...this.robots.keys()]) {
      if (!(serial in snapshot)) {
        this.robots.delete(serial);
        this.robotAborts.get(serial)?.abort();
        this.robotAborts.delete(serial);
      }
    }
    if (this.abort && !this.abort.signal.aborted) for (const s of this.robots.keys()) this.ensureRobotListener(s);
    for (const s of newlyConnected) {
      const r = this.robots.get(s);
      if (r?.connected && this.snap.version > 0) void this.refreshRobot(r, true);
    }
  }

  private async backoffLoop(signal: AbortSignal, run: () => Promise<void>) {
    let delay = 1000;
    while (!signal.aborted) {
      const started = Date.now();
      try {
        await run();
      } catch {
        /* reconnect below */
      }
      if (signal.aborted) return;
      delay = Date.now() - started > 30_000 ? 1000 : Math.min(delay * 2, 30_000);
      await sleep(delay);
    }
  }

  private serverEventsLoop(signal: AbortSignal) {
    return this.backoffLoop(signal, () =>
      this.client.streamServerEvents((m: SSEMessage) => {
        if (m.event !== 'robots') return;
        try {
          this.applyRobots(JSON.parse(m.data));
          this.status = 'online';
          this.emit();
        } catch { /* ignore malformed */ }
      }, signal),
    );
  }

  private ensureRobotListener(serial: string) {
    if (this.robotAborts.has(serial) || !this.abort || this.abort.signal.aborted) return;
    const ctrl = new AbortController();
    this.abort.signal.addEventListener('abort', () => ctrl.abort());
    this.robotAborts.set(serial, ctrl);
    void this.backoffLoop(ctrl.signal, () =>
      this.client.streamRobotEvents(serial, (m) => this.onRobotEvent(serial, m.data), ctrl.signal),
    );
  }

  private onRobotEvent(serial: string, raw: string) {
    const robot = this.robots.get(serial);
    if (!robot) return;
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    const before = robot.state;
    if (parseRobotEvent(robot, msg)) {
      this.emit();
      if (before === 'cleaning' && robot.state !== 'cleaning') this.delayedRunRefresh(robot);
    }
  }

  private async delayedRunRefresh(robot: RobotData) {
    await sleep(5000); // the server writes the run to history shortly after it ends
    try { robot.runs = parseRuns(robot.gen, await this.client.getRuns(robot.serial)); this.emit(); } catch { /* ignore */ }
  }

  // ---- commands

  private async cmd(serial: string, payload: Record<string, any>) {
    const robot = this.get(serial);
    if (!robot.connected) throw new ActionError(`${robot.name} is offline`);
    return this.client.command(serial, payload);
  }
  private async after(serial: string) {
    await this.refreshRobot(this.get(serial), false);
  }

  async sendRaw(serial: string, payload: Record<string, any>) {
    const r = await this.cmd(serial, payload);
    await this.after(serial);
    return r;
  }

  /** Start, or resume a paused cleaning (same precedence as the web app). */
  async startOrResume(serial: string) {
    const robot = this.get(serial);
    if (robot.canResume) return this.resume(serial);
    return this.startCleaning(serial);
  }

  resolveStart(robot: RobotData, o: StartOverrides = {}): StartRequest {
    const p = robot.prefs;
    const category = o.category ?? p.category;
    const mode = o.cleaningMode ?? p.mode;
    const nav = o.navigationMode ?? p.navigationMode;
    if (!cleaningModes(robot).includes(mode)) throw new ActionError(`Cleaning mode '${mode}' is not available on this robot`);
    const validNav = isGen3(robot) ? Object.keys(GEN3_NAV_IDS) : GEN4_NAV_MODES;
    if (!validNav.includes(nav)) throw new ActionError(`Navigation mode '${nav}' is not available on this robot`);
    if (category === 'spot' && !isGen3(robot)) throw new ActionError('Spot cleaning is only available on Gen3 robots');
    return {
      category, mode, navigationMode: nav, zoneKeys: o.zones ?? [...p.zoneKeys],
      nogoEnabled: o.nogoEnabled ?? p.nogoEnabled, spotWidth: o.spotWidth ?? p.spotWidth, spotHeight: o.spotHeight ?? p.spotHeight,
    };
  }

  async startCleaning(serial: string, o: StartOverrides = {}) {
    const robot = this.get(serial);
    const req = this.resolveStart(robot, o);
    let payload: Record<string, any>;
    try {
      payload = buildStartCommand(robot, req);
    } catch (e) {
      if (e instanceof StartError) throw new ActionError(e.message);
      throw e;
    }
    await this.cmd(serial, payload);
    await this.after(serial);
  }

  async pause(serial: string) {
    const r = this.get(serial);
    await this.cmd(serial, isGen3(r) ? gen3Cmd('pauseCleaning') : gen4Cmd('cleaning.pause'));
    await this.after(serial);
  }
  async resume(serial: string) {
    const r = this.get(serial);
    await this.cmd(serial, isGen3(r) ? gen3Cmd('resumeCleaning') : gen4Cmd('cleaning.resume'));
    await this.after(serial);
  }
  async stop(serial: string) {
    const r = this.get(serial);
    await this.cmd(serial, isGen3(r) ? gen3Cmd('stopCleaning') : gen4Cmd('cleaning.cancel'));
    await this.after(serial);
  }
  /** Send the robot home. While cleaning it must be paused first. */
  async returnToBase(serial: string) {
    const r = this.get(serial);
    if (r.canPause) {
      await this.pause(serial);
      await sleep(RETURN_TO_BASE_PAUSE_DELAY_MS);
    }
    await this.cmd(serial, isGen3(r) ? gen3Cmd('sendToBase') : gen4Cmd('navigation.return_to_base'));
    await this.after(serial);
  }
  async locate(serial: string) {
    const r = this.get(serial);
    await this.cmd(serial, isGen3(r) ? gen3Cmd('findMe') : gen4Cmd('utilities.find_me'));
  }
  async dismissAlert(serial: string) {
    if (!isGen3(this.get(serial))) throw new ActionError('Only Gen3 robots have dismissible alerts');
    await this.cmd(serial, gen3Cmd('dismissCurrentAlert'));
    await this.after(serial);
  }
  async exploreMap(serial: string) {
    if (!isGen3(this.get(serial))) throw new ActionError('Map exploration is only available on Gen3 robots');
    await this.cmd(serial, gen3Cmd('startPersistentMapExploration'));
    await this.after(serial);
  }

  /** Cleaning options kept on this device (like the web app's home-screen toggles). */
  setPrefs(serial: string, changes: Partial<RobotData['prefs']>) {
    Object.assign(this.get(serial).prefs, changes);
    this.emit();
  }

  // ---- settings

  async setGen3Preferences(serial: string, changes: Record<string, any>) {
    const r = this.get(serial);
    if (!r.gen3Preferences) await this.fetchSettings(r);
    const merged = { ...(r.gen3Preferences ?? {}), ...changes };
    await this.cmd(serial, gen3Cmd('setPreferences', merged));
    r.gen3Preferences = merged;
    this.emit();
    try { await this.fetchSettings(r); } catch { /* keep */ }
    this.emit();
  }
  async setGen4Setting(serial: string, setting: 'cleaning_options' | 'robot_language', changes: Record<string, any>) {
    const r = this.get(serial);
    const current = setting === 'cleaning_options' ? r.gen4CleaningOptions : r.gen4Language;
    const merged = { ...(current ?? {}), ...changes };
    await this.cmd(serial, gen4Cmd(setting === 'cleaning_options' ? 'settings.set_cleaning_options' : 'settings.set_robot_language', merged));
    if (setting === 'cleaning_options') r.gen4CleaningOptions = merged;
    else r.gen4Language = merged;
    this.emit();
    try { await this.fetchSettings(r); } catch { /* keep */ }
    this.emit();
  }
  async renameRobot(serial: string, name: string) {
    this.get(serial);
    await this.client.setRobotName(serial, name);
    this.get(serial).name = name;
    this.emit();
  }

  // ---- schedule

  async setScheduleEnabled(serial: string, enabled: boolean) {
    const r = this.get(serial);
    if (!isGen3(r)) throw new ActionError('Gen4 robots enable or disable single schedule events instead');
    await this.cmd(serial, gen3Cmd(enabled ? 'enableSchedule' : 'disableSchedule'));
    r.scheduleEnabled = enabled;
    this.emit();
    await this.refreshSchedule(r);
  }
  private async refreshSchedule(r: RobotData) {
    try { await this.fetchSchedule(r); } catch { /* keep */ }
    this.emit();
  }

  /** `time` is HH:MM in the server's timezone. */
  async addScheduleEvent(
    serial: string,
    o: { days: Day[]; time: string; mode?: string; navigationMode?: string; zones?: string[]; nogoEnabled?: boolean; useMap?: boolean },
  ) {
    const r = this.get(serial);
    if (!o.days.length) throw new ActionError('Pick at least one day');
    const mode = o.mode ?? r.prefs.mode;
    if (!cleaningModes(r).includes(mode)) throw new ActionError(`Cleaning mode '${mode}' is not available on this robot`);
    const zones = (o.zones ?? []).map((k) => this.zoneByKey(r, k));
    if (isGen3(r)) {
      if (zones.length > 1) throw new ActionError('Gen3 schedules support one zone per event');
      const added = o.days.map((d) => {
        const [day, time] = shiftSlot(GEN3_DAY_IDS[d], o.time, -this.utcOffsetMinutes);
        const ev: Record<string, any> = { mode: GEN3_MODE_IDS[mode], day, startTime: time };
        if (zones.length) ev.boundaryId = zones[0].id;
        return ev;
      });
      await this.cmd(serial, gen3Cmd('setSchedule', { events: [...added, ...r.schedule.map((e) => e.raw)] }));
    } else {
      const nav = o.navigationMode ?? r.prefs.navigationMode;
      const runs = gen4ScheduleRuns(r, {
        mode, navigationMode: nav, useMap: zones.length > 0 || !!o.useMap, zoneIds: zones.map((z) => z.id),
        nogoEnabled: o.nogoEnabled ?? r.prefs.nogoEnabled,
      });
      await this.cmd(serial, gen4Cmd('scheduling.update', {
        event: { enabled: true, days: o.days, time: o.time, command: { ability: 'cleaning.start', auto_localization: false, force_floorplan: false, runs } },
      }));
    }
    await this.refreshSchedule(r);
  }
  async removeScheduleEvent(serial: string, id: string) {
    const r = this.get(serial);
    if (!r.schedule.some((e) => e.id === id)) throw new ActionError('Schedule event not found');
    if (isGen3(r)) await this.cmd(serial, gen3Cmd('setSchedule', { events: r.schedule.filter((e) => e.id !== id).map((e) => e.raw) }));
    else await this.cmd(serial, gen4Cmd('scheduling.delete', { id }));
    await this.refreshSchedule(r);
  }
  async setScheduleEventEnabled(serial: string, id: string, enabled: boolean) {
    const r = this.get(serial);
    if (!isGen4(r)) throw new ActionError('Gen3 robots only support enabling or disabling the whole schedule');
    const ev = r.schedule.find((e) => e.id === id);
    if (!ev) throw new ActionError('Schedule event not found');
    await this.cmd(serial, gen4Cmd('scheduling.update', { event: { ...ev.raw, enabled } }));
    await this.refreshSchedule(r);
  }

  zoneByKey(r: RobotData, ref: string): ZoneInfo {
    const z = cleaningZones(r).find((x) => x.key === ref || x.id === ref);
    if (!z) throw new ActionError(`Zone '${ref.split(ZONE_KEY_SEP).pop()}' not found`);
    return z;
  }

  // ---- maps

  async renameMap(serial: string, map: MapInfo, name: string) {
    const r = this.get(serial);
    await this.client.updateMap(serial, map.id, name, map.enabled);
    await this.fetchSlow(r);
    this.emit();
  }
  async setMapEnabled(serial: string, map: MapInfo, enabled: boolean) {
    const r = this.get(serial);
    if (isGen3(r)) await this.client.updateMap(serial, map.id, map.name, enabled);
    else await this.client.useFloorplan(serial, map.id, enabled);
    await this.fetchSlow(r);
    this.emit();
  }
  async setFloorplanPromoted(serial: string, map: MapInfo, promoted: boolean) {
    const r = this.get(serial);
    if (!isGen4(r)) throw new ActionError('Only Gen4 robots have promoted floorplans');
    if (promoted) await this.client.promoteFloorplan(serial, map.id);
    else await this.client.demoteFloorplan(serial, map.id);
    await this.fetchSlow(r);
    this.emit();
  }
  /**
   * Add the floor map a cleaning ran on to the robot's maps list (Gen4 floorplans), optionally
   * making it the active floorplan. Returns the map and whether it was already listed.
   */
  async addRunMapToMaps(serial: string, run: RunSummary, makeActive = false): Promise<{ map: MapInfo; already: boolean }> {
    const r = this.get(serial);
    if (!run.mapId) throw new ActionError('This cleaning has no saved map.');
    let existing = r.maps.find((m) => m.id === run.mapId);
    const already = !!existing;
    if (!existing && isGen3(r)) {
      throw new ActionError('Gen3 robots only keep maps made with “Explore & create map”; this cleaning did not use one.');
    }
    if (!existing) {
      try {
        await this.floorMap(serial, run.mapId);
      } catch {
        throw new ActionError('The server has no saved floor map for this cleaning.');
      }
      await this.client.useFloorplan(serial, run.mapId, true);
      await this.fetchSlow(r);
      existing = r.maps.find((m) => m.id === run.mapId);
      if (!existing) throw new ActionError('The server did not add the map. Try again.');
      if (!existing.raw?.name) {
        // unnamed floorplans would show their UUID; give them a readable name
        const when = (run.started ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
        await this.client.updateMap(serial, existing.id, `Map ${when}`, existing.enabled);
        await this.fetchSlow(r);
        existing = r.maps.find((m) => m.id === run.mapId) ?? existing;
      }
      this.emit();
    }
    if (makeActive && isGen4(r) && !existing.promoted) {
      await this.setFloorplanPromoted(serial, existing, true);
      existing = r.maps.find((m) => m.id === run.mapId) ?? existing;
    }
    return { map: existing, already };
  }

  /** The newest cleaning that has a usable map, added to the maps list. */
  async useLatestRunMap(serial: string, makeActive = false): Promise<{ map: MapInfo; already: boolean; run: RunSummary }> {
    const r = this.get(serial);
    let lastError: Error | undefined;
    for (const run of r.runs.slice(0, 5)) {
      try {
        return { ...(await this.addRunMapToMaps(serial, run, makeActive)), run };
      } catch (e) {
        lastError = e as Error;
        if (!(e instanceof ActionError) || !/no saved (floor )?map|has no saved/.test(e.message)) throw e;
      }
    }
    throw lastError ?? new ActionError('No cleaning history yet.');
  }

  // ---- drawing zones

  /** Current boundaries of a map straight from the server (Gen4) or the robot (Gen3). */
  async loadBoundaries(serial: string, map: MapInfo): Promise<Boundary[]> {
    const r = this.get(serial);
    if (isGen4(r)) return (await this.client.getBoundaries(serial, map.id)) as Boundary[];
    const resp = await this.cmd(serial, gen3Cmd('getMapBoundaries', { mapId: map.id }));
    return (resp?.data?.boundaries ?? []) as Boundary[];
  }

  private async writeBoundaries(r: RobotData, map: MapInfo, list: Boundary[]) {
    const payload = serializeBoundaries(r.gen, list);
    if (isGen4(r)) {
      await this.client.setBoundaries(r.serial, map.id, payload);
      if (map.promoted) {
        // the robot only learns about changed zones when the floorplan is promoted again
        try {
          await this.client.promoteFloorplan(r.serial, map.id);
        } catch {
          await this.fetchSlow(r);
          this.emit();
          throw new ActionError('Saved on the server, but could not update the robot. Is it online? Make the map active again to push it.');
        }
      }
    } else {
      await this.cmd(r.serial, gen3Cmd('setMapBoundaries', { mapId: map.id, boundaries: payload }));
    }
    await this.fetchSlow(r);
    this.emit();
  }

  /** Create or update one zone / no-go. Re-reads the map first so other changes are never overwritten. */
  async saveBoundary(serial: string, map: MapInfo, boundary: Boundary): Promise<void> {
    const r = this.get(serial);
    const current = await this.loadBoundaries(serial, map);
    await this.writeBoundaries(r, map, upsertBoundary(current, boundary));
  }

  async deleteBoundary(serial: string, map: MapInfo, boundaryId: string): Promise<void> {
    const r = this.get(serial);
    const current = await this.loadBoundaries(serial, map);
    if (!current.some((b) => b.id === boundaryId)) throw new ActionError('That zone no longer exists.');
    await this.writeBoundaries(r, map, current.filter((b) => b.id !== boundaryId));
  }

  async setBoundaryEnabled(serial: string, boundaryId: string, enabled: boolean) {
    const r = this.get(serial);
    const promoted = promotedMap(r);
    if (!isGen4(r) || !promoted) throw new ActionError('No active floorplan to edit');
    const current = await this.client.getBoundaries(serial, promoted.id);
    const b = current.find((x) => x.id === boundaryId);
    if (!b) throw new ActionError('Boundary no longer exists');
    b.enabled = enabled;
    await this.client.setBoundaries(serial, promoted.id, current);
    await this.fetchZones(r);
    this.emit();
  }

  async floorMap(serial: string, mapId: string, fresh = false): Promise<any> {
    const key = `f:${serial}:${mapId}`;
    if (!fresh && this.mapCache.has(key)) return this.mapCache.get(key);
    const m = await this.client.getMap(serial, mapId);
    this.mapCache.set(key, m);
    return m;
  }
  async runMap(serial: string, runId: string): Promise<any> {
    const key = `r:${serial}:${runId}`;
    if (this.mapCache.has(key)) return this.mapCache.get(key);
    const m = await this.client.getRunMap(serial, runId);
    this.mapCache.set(key, m);
    return m;
  }
}

export { DAYS };
export type { Day };
