import React, { useState } from 'react';
import { Text } from 'react-native';
import { Btn, Card, Chips, Muted, PromptModal, SwitchRow } from '../../../src/components/ui';
import { isGen3, isGen4 } from '../../../src/lib/models';
import { RobotScroll, useRobotScreen } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

const MIN_PER_MONTH = 30 * 24 * 60;
const DIRTBIN = [30, 60, 90, 120, 150];
const FILTER_MONTHS = [1, 1.5, 2, 2.5, 3];
const BRUSH_MONTHS = [4, 5, 6, 7, 8];
const monthLabel = (m: number) => `${m} mo`;

export default function Settings() {
  const t = useTheme();
  const { serial, store, robot, busy, run } = useRobotScreen();
  const [renaming, setRenaming] = useState(false);

  return (
    <RobotScroll store={store} robot={robot}>
      {(r, st) => {
        const prefs = r.gen3Preferences;
        const opts = r.gen4CleaningOptions;
        const lang = r.gen4Language;
        const nearest = (value: number | undefined, choices: number[], unit = 1) =>
          value === undefined ? undefined : choices.reduce((a, b) => (Math.abs(b * unit - value) < Math.abs(a * unit - value) ? b : a));
        return (
          <>
            <Card title="Robot">
              <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{r.name}</Text>
              <Muted>
                {[r.model, r.firmware ? `firmware ${r.firmware}` : undefined, r.gen === 'neato.gen3' ? 'Gen 3' : 'Gen 4'].filter(Boolean).join(' · ')}
              </Muted>
              <Muted>Serial {r.serial}</Muted>
              <Btn label="Rename" onPress={() => setRenaming(true)} style={{ marginTop: 12 }} />
            </Card>

            {isGen3(r) && prefs ? (
              <Card title="Preferences">
                <SwitchRow
                  label="Robot sounds" value={!!prefs.robotSounds} disabled={!r.connected}
                  onValueChange={(v) => run('sounds', () => st.setGen3Preferences(serial, { robotSounds: v }))}
                />
                <Chips
                  label="Dust bin reminder (minutes of cleaning)"
                  options={DIRTBIN.map((n) => ({ value: String(n), label: String(n) }))}
                  value={String(nearest(prefs.dirtbinAlertReminderInterval, DIRTBIN))}
                  onChange={(v) => run('dirt', () => st.setGen3Preferences(serial, { dirtbinAlertReminderInterval: +v }))}
                />
                <Chips
                  label="Filter change reminder"
                  options={FILTER_MONTHS.map((n) => ({ value: String(n), label: monthLabel(n) }))}
                  value={String(nearest(prefs.filterChangeReminderInterval, FILTER_MONTHS, MIN_PER_MONTH))}
                  onChange={(v) => run('filter', () => st.setGen3Preferences(serial, { filterChangeReminderInterval: Math.round(+v * MIN_PER_MONTH) }))}
                />
                <Chips
                  label="Brush change reminder"
                  options={BRUSH_MONTHS.map((n) => ({ value: String(n), label: monthLabel(n) }))}
                  value={String(nearest(prefs.brushChangeReminderInterval, BRUSH_MONTHS, MIN_PER_MONTH))}
                  onChange={(v) => run('brush', () => st.setGen3Preferences(serial, { brushChangeReminderInterval: Math.round(+v * MIN_PER_MONTH) }))}
                />
              </Card>
            ) : null}

            {isGen4(r) && opts ? (
              <Card title="Cleaning options">
                <SwitchRow
                  label="Force floorplan" hint="Clean only with the active floorplan"
                  value={!!opts.force_floorplan} disabled={!r.connected}
                  onValueChange={(v) => run('ff', () => st.setGen4Setting(serial, 'cleaning_options', { force_floorplan: v }))}
                />
              </Card>
            ) : null}

            {isGen4(r) && lang?.available_languages?.length ? (
              <Card title="Robot language">
                <Chips
                  options={lang.available_languages.map((l: string) => ({ value: l, label: l.toUpperCase() }))}
                  value={lang.language}
                  onChange={(v) => run('lang', () => st.setGen4Setting(serial, 'robot_language', { language: v }))}
                />
              </Card>
            ) : null}
            {busy ? <Muted>Saving…</Muted> : null}

            <PromptModal
              visible={renaming} title="Rename robot" initial={r.name} onCancel={() => setRenaming(false)}
              onSubmit={(name) => {
                setRenaming(false);
                if (name.trim()) void run('name', () => st.renameRobot(serial, name.trim()));
              }}
            />
          </>
        );
      }}
    </RobotScroll>
  );
}
