import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ZoneEditor } from '../../../src/components/ZoneEditor';
import { MapView } from '../../../src/components/MapView';
import { Btn, Card, Muted, Pill, PromptModal, SwitchRow } from '../../../src/components/ui';
import { MapInfo, RobotData, ZoneInfo, enabledMaps, isGen3, isGen4, promotedMap } from '../../../src/lib/models';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

// Gen3 zones live on the robot, so it must be reachable; Gen4 zones are stored on the server.
const canEdit = (r: RobotData) => r.connected || isGen4(r);

export default function Maps() {
  const t = useTheme();
  const { serial, store, robot, busy, run } = useRobotScreen();
  const [selected, setSelected] = useState<string>();
  const [floor, setFloor] = useState<any>();
  const [loadError, setLoadError] = useState<string>();
  const [renaming, setRenaming] = useState<MapInfo>();
  const [editing, setEditing] = useState<{ zone?: ZoneInfo }>();

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

            {active ? (
              <Card title="Zones & no-go areas">
                {zones.map((z) => (
                  <View key={z.key} style={{ paddingVertical: 8 }}>
                    {isGen4(r) ? (
                      <SwitchRow
                        label={z.name} hint={z.shape === 'polyline' ? 'No-go line' : z.kind === 'zone' ? 'Cleaning zone' : 'No-go zone'}
                        value={z.enabled} disabled={!r.connected}
                        onValueChange={(v) => run(`z${z.id}`, () => st.setBoundaryEnabled(serial, z.id, v))}
                      />
                    ) : (
                      <>
                        <Text style={{ color: t.text, fontSize: 16 }}>{z.name}</Text>
                        <Muted>{z.kind === 'zone' ? 'Cleaning zone' : 'No-go line'}</Muted>
                      </>
                    )}
                    <Btn
                      label="Edit shape" onPress={() => setEditing({ zone: z })} disabled={!floor || !canEdit(r)}
                      style={{ marginTop: 4, alignSelf: 'flex-start' }}
                    />
                  </View>
                ))}
                {!zones.length ? <Muted>No zones or no-go areas on this map yet.</Muted> : null}
                <Btn
                  kind="primary" label="Draw new zone or no-go" onPress={() => setEditing({})}
                  disabled={!floor || !canEdit(r)} style={{ marginTop: 10 }}
                />
                {!floor ? <Muted>Waiting for the map to load…</Muted> : null}
                {floor && !canEdit(r) ? <Muted>The robot must be online to change zones.</Muted> : null}
              </Card>
            ) : null}

            {isGen4(r) ? (
              <Card title="From cleaning history">
                <Muted>
                  {r.runs.length
                    ? 'Add the floor map from your most recent cleaning to this list so you can clean by zone and see it here.'
                    : 'Once the robot has completed a cleaning, its map can be added here.'}
                </Muted>
                {r.runs.length ? (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    <Btn
                      label="Add latest cleaning’s map" busy={busy === 'latest'}
                      onPress={() => run('latest', async () => {
                        const res = await st.useLatestRunMap(serial, false);
                        setSelected(res.map.id);
                        Alert.alert(res.already ? 'Already added' : 'Map added', `“${res.map.name}” is in your maps list.`);
                      })}
                    />
                    <Btn
                      kind="primary" label="Add latest & make active" disabled={!r.connected} busy={busy === 'latestActive'}
                      onPress={() => run('latestActive', async () => {
                        const res = await st.useLatestRunMap(serial, true);
                        setSelected(res.map.id);
                        Alert.alert('Active floorplan', `“${res.map.name}” is now the active floorplan.`);
                      })}
                    />
                  </View>
                ) : null}
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

            {active && floor ? (
              <ZoneEditor
                visible={!!editing} gen={r.gen} floor={floor} existing={editing?.zone} zones={zones}
                onCancel={() => setEditing(undefined)}
                onSave={async (b) => {
                  await st.saveBoundary(serial, active, b);
                  setEditing(undefined);
                }}
                onDelete={editing?.zone ? async () => {
                  await st.deleteBoundary(serial, active, editing.zone!.id);
                  setEditing(undefined);
                } : undefined}
              />
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
