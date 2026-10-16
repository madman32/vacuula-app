import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VacuulaProvider } from '../src/context';
import { useTheme } from '../src/theme';

function Shell() {
  const t = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Vacuula' }} />
        <Stack.Screen name="connect" options={{ title: 'Connect to server', presentation: 'modal' }} />
        <Stack.Screen name="robot/[serial]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <VacuulaProvider>
        <Shell />
      </VacuulaProvider>
    </SafeAreaProvider>
  );
}
