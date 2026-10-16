import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { Banner, useAction } from './components/ui';
import { useRobot } from './context';
import { RobotData } from './lib/models';
import { VacuulaStore } from './lib/store';
import { useTheme } from './theme';

export function useRobotScreen() {
  const { serial } = useLocalSearchParams<{ serial: string }>();
  const { store, robot, snap } = useRobot(serial);
  const action = useAction();
  return { serial, store, robot, snap, ...action };
}

/** Scroll container with pull-to-refresh and the standard "offline / missing" banners. */
export function RobotScroll({
  store, robot, children,
}: { store?: VacuulaStore; robot?: RobotData; children: (r: RobotData, s: VacuulaStore) => React.ReactNode }) {
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  if (!store || !robot) {
    return <Text style={{ color: t.sub, padding: 16 }}>Robot not found. It may have been removed from the server.</Text>;
  }
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await store.refreshAllNow();
            setRefreshing(false);
          }}
        />
      }
    >
      {!robot.connected ? <Banner text="This robot is offline. Controls are unavailable until it reconnects." /> : null}
      {children(robot, store)}
    </ScrollView>
  );
}
