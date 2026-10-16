/**
 * Async client for the Vacuula server HTTP API (the same API the bundled web app uses).
 * There is no authentication. Gen3 robots take {cmd, params}; Gen4 robots take {ability, ...}.
 */

export class VacuulaError extends Error {}
export class VacuulaConnectionError extends VacuulaError {}
export class VacuulaApiError extends VacuulaError {
  constructor(public status: number, public detail: string, public body?: unknown) {
    super(`${status}: ${detail}`);
  }
}
export class VacuulaCommandError extends VacuulaApiError {}

export interface SSEMessage {
  event?: string;
  data: string;
}

type FetchLike = (url: string, init?: any) => Promise<any>;

const REQUEST_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 40_000; // server waits up to 30 s for a robot
const SSE_IDLE_TIMEOUT_MS = 60_000; // server sends a keep-alive every 15 s

function errorMessage(body: any): string {
  if (body && typeof body === 'object') {
    for (const k of ['error', 'message', 'result']) if (typeof body[k] === 'string') return body[k];
    if (body.body && typeof body.body === 'object') return errorMessage(body.body);
  }
  if (typeof body === 'string' && body) return body;
  return 'unknown error';
}

/** The server answers some endpoints with bare "OK" labelled application/json, so never trust the type. */
function parseBody(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Incremental SSE parser. Feed decoded text chunks; returns completed messages. */
export class SSEParser {
  private buffer = '';
  private event: string | undefined;
  private data: string[] = [];

  push(chunk: string): SSEMessage[] {
    this.buffer += chunk;
    const out: SSEMessage[] = [];
    let idx: number;
    while ((idx = this.buffer.search(/\r\n|\n|\r/)) >= 0) {
      const line = this.buffer.slice(0, idx);
      const eol = this.buffer.slice(idx).match(/^(\r\n|\n|\r)/)![0];
      this.buffer = this.buffer.slice(idx + eol.length);
      if (line === '') {
        if (this.data.length) out.push({ event: this.event, data: this.data.join('\n') });
        this.event = undefined;
        this.data = [];
      } else if (!line.startsWith(':')) {
        const c = line.indexOf(':');
        const field = c < 0 ? line : line.slice(0, c);
        let value = c < 0 ? '' : line.slice(c + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') this.event = value;
        else if (field === 'data') this.data.push(value);
      }
    }
    return out;
  }
}

export class VacuulaClient {
  constructor(public host: string, public port: number, private fetchImpl: FetchLike = (u, i) => (globalThis as any).fetch(u, i)) {}

  get baseUrl(): string {
    const host = this.host.includes(':') && !this.host.startsWith('[') ? `[${this.host}]` : this.host;
    return `http://${host}:${this.port}`;
  }

  private async request(
    method: string, path: string, opts: { body?: unknown; timeout?: number; command?: boolean } = {},
  ): Promise<any> {
    const ErrCls = opts.command ? VacuulaCommandError : VacuulaApiError;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? REQUEST_TIMEOUT_MS);
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: ctrl.signal,
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const body = parseBody(await resp.text());
      if (resp.status >= 400) throw new ErrCls(resp.status, errorMessage(body), body);
      return body;
    } catch (err) {
      if (err instanceof VacuulaError) throw err;
      throw new VacuulaConnectionError(`Cannot reach Vacuula server at ${this.baseUrl}: ${(err as Error)?.message ?? err}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stream server-sent events until the stream ends, errors, or `signal` aborts.
   * Calls onMessage for each message; throws VacuulaConnectionError when the stream drops.
   */
  async stream(path: string, onMessage: (m: SSEMessage) => void, signal: AbortSignal): Promise<void> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener('abort', onAbort);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), SSE_IDLE_TIMEOUT_MS);
    };
    try {
      arm();
      const resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: 'text/event-stream' }, signal: ctrl.signal,
      });
      if (resp.status >= 400) throw new VacuulaApiError(resp.status, errorMessage(parseBody(await resp.text())));
      if (!resp.body?.getReader) throw new VacuulaConnectionError('Streaming responses are not supported here');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SSEParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        for (const m of parser.push(decoder.decode(value, { stream: true }))) onMessage(m);
      }
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof VacuulaError) throw err;
      throw new VacuulaConnectionError(`Event stream ${path} dropped: ${(err as Error)?.message ?? err}`);
    } finally {
      if (idle) clearTimeout(idle);
      signal.removeEventListener('abort', onAbort);
      ctrl.abort();
    }
  }

  streamServerEvents = (onMessage: (m: SSEMessage) => void, signal: AbortSignal) =>
    this.stream('/api/events', onMessage, signal);
  streamRobotEvents = (serial: string, onMessage: (m: SSEMessage) => void, signal: AbortSignal) =>
    this.stream(`/api/robot/${serial}/connect`, onMessage, signal);

  // server
  async getServerInfo(): Promise<{ version: string; timezone?: string; utc_offset_minutes?: number; [k: string]: any }> {
    const info = await this.request('GET', '/api/server');
    if (!info || typeof info !== 'object' || !('version' in info)) throw new VacuulaApiError(200, 'Not a Vacuula server');
    return info;
  }
  async getRobots(): Promise<Record<string, any>> {
    const r = await this.request('GET', '/api/robots');
    return r && typeof r === 'object' ? r : {};
  }

  // robots
  command = (serial: string, payload: Record<string, any>) =>
    this.request('POST', `/api/robot/${serial}/command`, { body: payload, timeout: COMMAND_TIMEOUT_MS, command: true });
  setRobotName = (serial: string, name: string) => this.request('POST', `/api/robot/${serial}`, { body: { name } });

  // maps
  async getMaps(serial: string): Promise<any[]> {
    const r = await this.request('GET', `/api/robot/${serial}/maps`);
    return Array.isArray(r) ? r : [];
  }
  getMap = (serial: string, mapId: string) => this.request('GET', `/api/robot/${serial}/maps/${mapId}`);
  updateMap = (serial: string, mapId: string, name: string, enabled: boolean) =>
    this.request('POST', `/api/robot/${serial}/maps/${mapId}`, { body: { name, enabled } });
  async getBoundaries(serial: string, mapId: string): Promise<any[]> {
    const r = await this.request('GET', `/api/robot/${serial}/maps/${mapId}/boundaries`);
    return Array.isArray(r) ? r : [];
  }
  setBoundaries = (serial: string, mapId: string, boundaries: any[]) =>
    this.request('POST', `/api/robot/${serial}/maps/${mapId}/boundaries`, { body: boundaries });
  useFloorplan = (serial: string, mapId: string, use: boolean) =>
    this.request('POST', `/api/robot/${serial}/maps/${mapId}/${use ? 'use' : 'unuse'}`);
  promoteFloorplan = (serial: string, mapId: string) =>
    this.request('POST', `/api/robot/${serial}/maps/${mapId}/promote`, { timeout: COMMAND_TIMEOUT_MS });
  demoteFloorplan = (serial: string, mapId: string) =>
    this.request('DELETE', `/api/robot/${serial}/maps/${mapId}`, { timeout: COMMAND_TIMEOUT_MS });

  // runs
  async getRuns(serial: string): Promise<any[]> {
    const r = await this.request('GET', `/api/robot/${serial}/runs`);
    return Array.isArray(r) ? r : [];
  }
  getRunMap = (serial: string, runId: string) => this.request('GET', `/api/robot/${serial}/run/${runId}`);
}
