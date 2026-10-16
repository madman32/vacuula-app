import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MapView } from '../../../src/components/MapView';
import { Btn, Card, Muted, Pill, PromptModal, SwitchRow } from '../../../src/components/ui';
import { MapInfo, enabledMaps, isGen3, isGen4, promotedMap } from '../../../src/lib/models';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

export default function Maps() {
  const t = useTheme();
  const { serial, store, robot, busy, run } = useRobotScreen();
  const [selected, setSelected] = useState<string>();
  const [floor, setFloor] = useState<any>();
  const [loadError, setLoadError] = useState<string>();
  const [renaming, setRenaming] = useState<MapInfo>();

  const maps = robot ? (isGen4(robot) ? robot.maps : robot.maps) : [];
  const active = robot
    ? maps.find((m) => m.id === selected) ?? (isGen4(robot) ? promotedMap(robot) : enabledMaps(robot)[0]) ?? maps[0]
    : undefined;
  const activeId = active?.id;

  useEffect(() => {
    let live = true;
    setFloor(undefined);
    setLoadError(undefined);
    if (store && activeId) {
      store.floorMap(serial, activeId).then((m) => live && setFloor(m)).catch((e) => live && setLoadError(e.message));
    }
    return () => { live = false; };
  }, [store, serial, activeId]);

  return (
    <RobotScroll store={store} robot={robot}>
      {(r, st) => {
        const zones = r.zones.filter((z) => z.mapId === activeId);
        return (
          <>
            <Card title={active ? active.name : 'Map'}>
              {active ? (
                floor ? <MapView floor={floor} zones={zones} /> : <Muted>{loadError ?? 'Loading map…'}</Muted>
              ) : (
                <Muted>This robot has no saved maps yet.{isGen3(r) ? ' Use “Explore & create map” below to make one.' : ''}</Muted>
              )}
            </Card>

            {maps.length ? (
              <Card title={isGen3(r) ? 'Persistent maps' : 'Floorplans'}>
                {maps.map((m) => (
                  <View key={m.id} style={{ paddingVertical: 8 }}>
                    <Text onPress={() => setSelected(m.id)} style={{ color: t.text, fontSize: 16, fontWeight: m.id === activeId ? '800' : '500' }}>
                      {m.name}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                      {m.promoted ? <Pill text="Active" tone="ok" /> : null}
                      {!m.enabled ? <Pill text={isGen3(r) ? 'Disabled' : 'Hidden'} tone="warn" /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <Btn label="Rename" onPress={() => setRenaming(m)} />
                      <Btn
                        label={m.enabled ? (isGen3(r) ? 'Disable' : 'Hide') : isGen3(r) ? 'Enable' : 'Show'}
                        busy={busy === `en${m.id}`} disabled={!r.connected && isGen3(r)}
                        onPress={() => run(`en${m.id}`, () => st.setMapEnabled(serial, m, !m.enabled))}
                      />
                      {isGen4(r) ? (
                        <Btn
                          label={m.promoted ? 'Deactivate' : 'Make active'} busy={busy === `pr${m.id}`} disabled={!r.connected}
                          onPress={() => run(`pr${m.id}`, () => st.setFloorplanPromoted(serial, m, !m.promoted))}
                        />
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            {zones.length ? (
              <Card title="Zones & no-go areas">
                {zones.map((z) => (
                  isGen4(r) ? (
                    <SwitchRow
                      key={z.key} label={z.name} hint={z.kind === 'zone' ? 'Cleaning zone' : 'No-go'}
                      value={z.enabled} disabled={!r.connected}
                      onValueChange={(v) => run(`z${z.id}`, () => st.setBoundaryEnabled(serial, z.id, v))}
                    />
                  ) : (
                    <View key={z.key} style={{ paddingVertical: 6 }}>
                      <Text style={{ color: t.text, fontSize: 16 }}>{z.name}</Text>
                      <Muted>{z.kind === 'zone' ? 'Cleaning zone' : 'No-go line'}</Muted>
                    </View>
                  )
                ))}
                <Muted>Drawing new zones isn’t available in the app yet — use the Vacuula web interface.</Muted>
              </Card>
            ) : null}

            {isGen3(r) ? (
              <Card title="Mapping">
                <Muted>Drive the robot around the house to build a new persistent map.</Muted>
                <Btn
                  label="Explore & create map" style={{ marginTop: 10 }} disabled={!r.connected || !r.isDocked} busy={busy === 'explore'}
                  onPress={() => run('explore', () => st.exploreMap(serial))}
                />
                {!r.isDocked ? <Muted>The robot must be docked to start.</Muted> : null}
              </Card>
            ) : null}

            <PromptModal
              visible={!!renaming} title="Rename map" initial={renaming?.name}
              onCancel={() => setRenaming(undefined)}
              onSubmit={(name) => {
                const m = renaming;
                setRenaming(undefined);
                if (m && name.trim()) void run('rename', () => st.renameMap(serial, m, name.trim()));
              }}
            />
          </>
        );
      }}
    </RobotScroll>
  );
}
