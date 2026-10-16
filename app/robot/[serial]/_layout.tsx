import { Ionicons } from '@expo/vector-icons';
import { Tabs, useGlobalSearchParams } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import { useRobot } from '../../../src/context';
import { RobotSerialContext } from '../../../src/useRobotScreen';
import { useTheme } from '../../../src/theme';

const icon = (name: React.ComponentProps<typeof Ionicons>['name']) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function RobotTabs() {
  const t = useTheme();
  const params = useGlobalSearchParams<{ serial: string | string[] }>();
  const serial = Array.isArray(params.serial) ? params.serial[0] : params.serial;
  const { robot } = useRobot(serial);
  return (
    <RobotSerialContext.Provider value={serial}>
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.sub,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" initialParams={{ serial }} options={{ title: robot?.name ?? 'Robot', tabBarLabel: 'Control', tabBarIcon: icon('play-circle-outline') }} />
      <Tabs.Screen name="map" initialParams={{ serial }} options={{ title: 'Maps', tabBarIcon: icon('map-outline') }} />
      <Tabs.Screen name="schedule" initialParams={{ serial }} options={{ title: 'Schedule', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="history" initialParams={{ serial }} options={{ title: 'History', tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen name="settings" initialParams={{ serial }} options={{ title: 'Settings', tabBarIcon: icon('options-outline') }} />
    </Tabs>
    </RobotSerialContext.Provider>
  );
}
