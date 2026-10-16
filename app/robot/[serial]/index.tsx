import React from 'react';
import { Text, View } from 'react-native';
import { Banner, Battery, Btn, Card, Chips, Muted, Pill, SwitchRow } from '../../../src/components/ui';
import {
  Category, STATE_LABELS, cleaningModes, cleaningZones, formatNavMode, isCleaning, isGen3, isGen4, navigationModes, zoneLabel,
} from '../../../src/lib/models';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

export default function Control() {
  const t = useTheme();
  const { serial, store, robot, busy, run } = useRobotScreen();
  return (
    <RobotScroll store={store} robot={robot}>
      {(r, st) => {
        const off = !r.connected;
        const cleaning = isCleaning(r);
        const zones = cleaningZones(r);
        const categories: Category[] = isGen3(r) ? ['house', 'map', 'spot'] : ['house', 'map'];
        const p = r.prefs;
        const canDock = r.canReturnToBase || r.canPause;
        return (
          <>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: t.text, fontSize: 24, fontWeight: '800' }}>{r.state ? STATE_LABELS[r.state] : '…'}</Text>
                <Battery level={r.battery} charging={r.isCharging} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {r.isDocked ? <Pill text="Docked" tone="ok" /> : null}
                {r.isCharging ? <Pill text="Charging" tone="ok" /> : null}
                {r.model ? <Pill text={r.model} /> : null}
              </View>
              {r.errors.length ? <Text style={{ color: t.danger, marginTop: 10 }}>Error: {r.errors.join(', ')}</Text> : null}
            </Card>

            {r.alert ? (
              <Banner text={`Alert: ${r.alert}`} />
            ) : null}
            {r.alert && isGen3(r) ? (
              <Btn label="Dismiss alert" onPress={() => run('alert', () => st.dismissAlert(serial))} busy={busy === 'alert'} style={{ marginBottom: 12 }} />
            ) : null}

            <Card title="Controls">
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn
                  flex kind="primary" label={r.canResume ? 'Resume' : 'Start'}
                  disabled={off || !(r.canStart || r.canResume)} busy={busy === 'start'}
                  onPress={() => run('start', () => st.startOrResume(serial))}
                />
                <Btn flex label="Pause" disabled={off || !r.canPause} busy={busy === 'pause'} onPress={() => run('pause', () => st.pause(serial))} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Btn flex label="Stop" disabled={off || !r.canStop} busy={busy === 'stop'} onPress={() => run('stop', () => st.stop(serial))} />
                <Btn flex label="Return to base" disabled={off || !canDock} busy={busy === 'dock'} onPress={() => run('dock', () => st.returnToBase(serial))} />
              </View>
              <Btn label="Find my robot" disabled={off} busy={busy === 'locate'} onPress={() => run('locate', () => st.locate(serial))} style={{ marginTop: 8 }} />
            </Card>

            <Card title="Next cleaning">
              <Chips
                label="Type"
                options={categories.map((c) => ({ value: c, label: c === 'house' ? 'Whole house' : c === 'map' ? 'Map / zones' : 'Spot' }))}
                value={p.category}
                onChange={(c) => st.setPrefs(serial, { category: c })}
              />
              <Chips
                label="Cleaning mode"
                options={cleaningModes(r).map((m) => ({ value: m, label: formatNavMode(m) }))}
                value={p.mode} onChange={(m) => st.setPrefs(serial, { mode: m })}
              />
              <Chips
                label="Navigation"
                options={navigationModes(r).map((m) => ({ value: m, label: formatNavMode(m) }))}
                value={p.navigationMode} onChange={(m) => st.setPrefs(serial, { navigationMode: m })}
              />
              {p.category === 'map' ? (
                <>
                  {zones.length ? (
                    <Chips
                      multi={isGen4(r)}
                      label={isGen3(r) ? 'Zone (whole map if none)' : 'Zones (whole floorplan if none)'}
                      options={zones.map((z) => ({ value: z.key, label: zoneLabel(r, z) }))}
                      value={p.zoneKeys}
                      onChange={(k) => {
                        const has = p.zoneKeys.includes(k);
                        const next = isGen4(r) ? (has ? p.zoneKeys.filter((x) => x !== k) : [...p.zoneKeys, k]) : has ? [] : [k];
                        st.setPrefs(serial, { zoneKeys: next });
                      }}
                    />
                  ) : (
                    <Muted>No zones on the active map yet.</Muted>
                  )}
                  {isGen4(r) ? (
                    <SwitchRow label="Use no-go zones" value={p.nogoEnabled} onValueChange={(v) => st.setPrefs(serial, { nogoEnabled: v })} />
                  ) : null}
                  {!r.isDocked ? <Muted>Map and zone cleaning starts from the dock.</Muted> : null}
                </>
              ) : null}
              {p.category === 'spot' && isGen3(r) ? (
                <>
                  <Chips
                    label="Spot size (cm)"
                    options={[100, 150, 200, 250, 300, 400].map((n) => ({ value: String(n), label: String(n) }))}
                    value={String(p.spotWidth)}
                    onChange={(n) => st.setPrefs(serial, { spotWidth: +n, spotHeight: +n })}
                  />
                </>
              ) : null}
              {cleaning ? <Muted>Changes apply to the next cleaning.</Muted> : null}
            </Card>
          </>
        );
      }}
    </RobotScroll>
  );
}
