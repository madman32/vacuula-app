import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MapView } from '../../../src/components/MapView';
import { Card, Muted } from '../../../src/components/ui';
import { RunSummary, runDurationMinutes } from '../../../src/lib/models';
import { VacuulaStore } from '../../../src/lib/store';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

function RunMap({ store, serial, run }: { store: VacuulaStore; serial: string; run: RunSummary }) {
  const [data, setData] = useState<{ floor?: any; path?: any }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const path = await store.runMap(serial, run.id);
        let floor: any;
        if (run.mapId) {
          try { floor = await store.floorMap(serial, run.mapId); } catch { /* path only */ }
        }
        if (live) setData({ floor, path });
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, [store, serial, run]);
  if (error) return <Muted>No map available for this cleaning.</Muted>;
  if (!data) return <Muted>Loading map…</Muted>;
  return <View style={{ marginTop: 10 }}><MapView floor={data.floor} run={data.path} /></View>;
}

export default function History() {
  const t = useTheme();
  const { serial, store, robot } = useRobotScreen();
  const [open, setOpen] = useState<string>();
  return (
    <RobotScroll store={store} robot={robot}>
      {(r, st) =>
        r.runs.length ? (
          <>
            {r.runs.map((run) => {
              const mins = runDurationMinutes(run);
              const isOpen = open === run.id;
              return (
                <Pressable key={run.id} onPress={() => setOpen(isOpen ? undefined : run.id)}>
                  <Card>
                    <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>
                      {run.started ? run.started.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : run.id}
                    </Text>
                    <Muted>
                      {[
                        mins !== undefined ? `${mins} min` : undefined,
                        run.area !== undefined ? `${run.area.toFixed(1)} m²` : undefined,
                        run.batteryUsed !== undefined ? `${run.batteryUsed}% battery` : undefined,
                        run.startedBy,
                        run.complete === false ? 'incomplete' : undefined,
                      ].filter(Boolean).join(' · ')}
                    </Muted>
                    {isOpen ? <RunMap store={st} serial={serial} run={run} /> : null}
                  </Card>
                </Pressable>
              );
            })}
          </>
        ) : (
          <Muted>No cleanings recorded yet.</Muted>
        )
      }
    </RobotScroll>
  );
}
