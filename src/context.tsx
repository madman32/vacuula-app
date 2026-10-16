import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VacuulaClient } from './lib/client';
import { Snapshot, VacuulaStore } from './lib/store';

const KEY = 'vacuula.server.v1';
const EMPTY: Snapshot = { version: 0, status: 'connecting', robots: [] };
const noopSubscribe = () => () => {};

interface Ctx {
  ready: boolean;
  server?: { host: string; port: number };
  store?: VacuulaStore;
  connectTo(host: string, port: number): Promise<void>;
  forget(): Promise<void>;
}

const VacuulaContext = createContext<Ctx>({
  ready: false, connectTo: async () => {}, forget: async () => {},
});

async function readSaved(): Promise<{ host: string; port: number } | undefined> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function VacuulaProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState<Ctx['server']>();
  const [store, setStore] = useState<VacuulaStore>();
  const current = useRef<VacuulaStore>(undefined);

  const open = useCallback((host: string, port: number) => {
    current.current?.shutdown();
    const s = new VacuulaStore(new VacuulaClient(host, port));
    current.current = s;
    setServer({ host, port });
    setStore(s);
    void s.connect();
  }, []);

  useEffect(() => {
    void readSaved().then((saved) => {
      if (saved) open(saved.host, saved.port);
      setReady(true);
    });
    return () => current.current?.shutdown();
  }, [open]);

  const connectTo = useCallback(async (host: string, port: number) => {
    // validate first so a typo never replaces a working connection
    await new VacuulaClient(host, port).getServerInfo();
    try { await AsyncStorage.setItem(KEY, JSON.stringify({ host, port })); } catch { /* best effort */ }
    open(host, port);
  }, [open]);

  const forget = useCallback(async () => {
    current.current?.shutdown();
    current.current = undefined;
    setStore(undefined);
    setServer(undefined);
    try { await AsyncStorage.removeItem(KEY); } catch { /* best effort */ }
  }, []);

  return (
    <VacuulaContext.Provider value={{ ready, server, store, connectTo, forget }}>{children}</VacuulaContext.Provider>
  );
}

export const useVacuulaContext = () => useContext(VacuulaContext);

/** Live snapshot of the connected server (empty until connected). */
export function useSnapshot(): Snapshot {
  const { store } = useContext(VacuulaContext);
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => EMPTY);
}

export function useRobot(serial: string) {
  const { store } = useContext(VacuulaContext);
  const snap = useSnapshot();
  const robot = snap.robots.find((r) => r.serial === serial);
  return { store, robot, snap };
}
