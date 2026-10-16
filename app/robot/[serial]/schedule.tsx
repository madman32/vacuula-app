import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Btn, Card, Chips, Field, Muted, Pill, SwitchRow } from '../../../src/components/ui';
import {
  DAYS, Day, ScheduleEvent, cleaningModes, cleaningZones, formatNavMode, isGen3, isGen4, navigationModes, zoneLabel,
} from '../../../src/lib/models';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

const DAY_LABELS: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function describe(e: ScheduleEvent, zoneName: (id: string) => string | undefined) {
  const parts = [e.days.map((d) => DAY_LABELS[d] ?? d).join(', '), e.time];
  if (e.mode) parts.push(formatNavMode(e.mode));
  const zones = e.zoneIds.map(zoneName).filter(Boolean);
  if (zones.length) parts.push(zones.join(' + '));
  return parts.join(' · ');
}

export default function Schedule() {
  const t = useTheme();
  const { serial, store, robot, busy, run } = useRobotScreen();
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState<Day[]>([]);
  const [time, setTime] = useState('09:00');
  const [mode, setMode] = useState<string>();
  const [nav, setNav] = useState<string>();
  const [zoneKeys, setZoneKeys] = useState<string[]>([]);

  return (
    <RobotScroll store={store} robot={robot}>
      {(r, st) => {
        const zones = cleaningZones(r);
        const next = st.nextScheduled(r);
        const zoneName = (id: string) => r.zones.find((z) => z.id === id)?.name;
        const save = async () => {
          const m = TIME_RE.exec(time.trim());
          if (!m) return Alert.alert('Invalid time', 'Use 24-hour time like 07:30.');
          if (!days.length) return Alert.alert('Pick days', 'Choose at least one day of the week.');
          const hhmm = `${m[1].padStart(2, '0')}:${m[2]}`;
          await run('add', async () => {
            await st.addScheduleEvent(serial, {
              days, time: hhmm, mode: mode ?? r.prefs.mode, navigationMode: nav ?? r.prefs.navigationMode, zones: zoneKeys,
            });
            setAdding(false);
            setDays([]);
            setZoneKeys([]);
          });
        };
        return (
          <>
            {isGen3(r) ? (
              <Card>
                <SwitchRow
                  label="Scheduled cleaning" hint="Master switch for all scheduled events"
                  value={!!r.scheduleEnabled} disabled={!r.connected}
                  onValueChange={(v) => run('master', () => st.setScheduleEnabled(serial, v))}
                />
              </Card>
            ) : null}

            <Card title="Events">
              {next && r.scheduleEnabled !== false ? (
                <Muted>Next: {next.toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</Muted>
              ) : null}
              {r.schedule.length ? (
                r.schedule.map((e) => (
                  <View key={e.id} style={{ paddingVertical: 10 }}>
                    <Text style={{ color: t.text, fontSize: 16 }}>{describe(e, zoneName)}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      {isGen4(r) ? (
                        <SwitchRow
                          label={e.enabled ? 'Enabled' : 'Disabled'} value={e.enabled} disabled={!r.connected}
                          onValueChange={(v) => run(`en${e.id}`, () => st.setScheduleEventEnabled(serial, e.id, v))}
                        />
                      ) : <View />}
                      <Btn
                        kind="danger" label="Delete" disabled={!r.connected} busy={busy === `rm${e.id}`}
                        onPress={() =>
                          Alert.alert('Delete event', describe(e, zoneName), [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => void run(`rm${e.id}`, () => st.removeScheduleEvent(serial, e.id)) },
                          ])
                        }
                      />
                    </View>
                  </View>
                ))
              ) : (
                <Muted>No cleanings scheduled.</Muted>
              )}
              {st.timezone ? <Pill text={`Times in ${st.timezone}`} /> : null}
            </Card>

            {adding ? (
              <Card title="New event">
                <Chips multi label="Days" options={DAYS.map((d) => ({ value: d, label: DAY_LABELS[d] }))} value={days}
                  onChange={(d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))} />
                <Field label="Time (24 h, HH:MM)" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} />
                <Chips label="Cleaning mode" options={cleaningModes(r).map((m) => ({ value: m, label: formatNavMode(m) }))}
                  value={mode ?? r.prefs.mode} onChange={setMode} />
                {isGen4(r) ? (
                  <Chips label="Navigation" options={navigationModes(r).map((m) => ({ value: m, label: formatNavMode(m) }))}
                    value={nav ?? r.prefs.navigationMode} onChange={setNav} />
                ) : null}
                {zones.length ? (
                  <Chips
                    multi={isGen4(r)} label={isGen3(r) ? 'Zone (optional)' : 'Zones (optional)'}
                    options={zones.map((z) => ({ value: z.key, label: zoneLabel(r, z) }))} value={zoneKeys}
                    onChange={(k) => setZoneKeys((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : isGen4(r) ? [...cur, k] : [k]))}
                  />
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                  <Btn flex label="Cancel" onPress={() => setAdding(false)} />
                  <Btn flex kind="primary" label="Save" busy={busy === 'add'} onPress={save} />
                </View>
              </Card>
            ) : (
              <Btn kind="primary" label="Add event" disabled={!r.connected} onPress={() => setAdding(true)} />
            )}
          </>
        );
      }}
    </RobotScroll>
  );
}
