import { Ionicons } from '@expo/vector-icons';
import { Tabs, useLocalSearchParams } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import { useRobot } from '../../../src/context';
import { useTheme } from '../../../src/theme';

const icon = (name: React.ComponentProps<typeof Ionicons>['name']) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function RobotTabs() {
  const t = useTheme();
  const { serial } = useLocalSearchParams<{ serial: string }>();
  const { robot } = useRobot(serial);
  return (
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
      <Tabs.Screen name="index" options={{ title: robot?.name ?? 'Robot', tabBarLabel: 'Control', tabBarIcon: icon('play-circle-outline') }} />
      <Tabs.Screen name="map" options={{ title: 'Maps', tabBarIcon: icon('map-outline') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('options-outline') }} />
    </Tabs>
  );
}
