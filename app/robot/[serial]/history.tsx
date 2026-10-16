import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MapView } from '../../../src/components/MapView';
import { Alert } from 'react-native';
import { Btn, Card, Muted, useAction } from '../../../src/components/ui';
import { RobotData, RunSummary, isGen4, runDurationMinutes } from '../../../src/lib/models';
import { VacuulaStore } from '../../../src/lib/store';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

function RunMap({ store, serial, run, robot }: { store: VacuulaStore; serial: string; run: RunSummary; robot: RobotData }) {
  const { busy, run: act } = useAction();
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
  const listed = robot.maps.find((m) => m.id === run.mapId);
  const add = (makeActive: boolean) =>
    act(makeActive ? 'active' : 'add', async () => {
      const res = await store.addRunMapToMaps(serial, run, makeActive);
      Alert.alert('Map added', `“${res.map.name}” is now in the Maps tab${res.map.promoted ? ' and is the active floorplan' : ''}.`);
    });
  return (
    <View style={{ marginTop: 10 }}>
      <MapView floor={data.floor} run={data.path} />
      {data.floor && run.mapId ? (
        listed ? (
          <>
            <Muted>This cleaning’s map is in your Maps tab{listed.promoted ? ' (active floorplan)' : ''}.</Muted>
            {isGen4(robot) && !listed.promoted ? (
              <Btn label="Make active floorplan" disabled={!robot.connected} busy={busy === 'active'} onPress={() => add(true)} style={{ marginTop: 8 }} />
            ) : null}
          </>
        ) : isGen4(robot) ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Btn label="Use as floor map" busy={busy === 'add'} onPress={() => add(false)} />
            <Btn kind="primary" label="Use & make active" disabled={!robot.connected} busy={busy === 'active'} onPress={() => add(true)} />
          </View>
        ) : null
      ) : null}
    </View>
  );
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
                    {isOpen ? <RunMap store={st} serial={serial} run={run} robot={r} /> : null}
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
