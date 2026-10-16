import { Ionicons } from '@expo/vector-icons';
import { Link, Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Battery, Btn, Card, Muted, Pill } from '../src/components/ui';
import { useSnapshot, useVacuulaContext } from '../src/context';
import { STATE_LABELS } from '../src/lib/models';
import { useTheme } from '../src/theme';

export default function Robots() {
  const t = useTheme();
  const router = useRouter();
  const { ready, server, store, forget } = useVacuulaContext();
  const snap = useSnapshot();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (ready && !server) router.replace('/connect');
  }, [ready, server, router]);

  if (!ready || !server) return null;

  const refresh = async () => {
    setRefreshing(true);
    await store?.refreshAllNow();
    setRefreshing(false);
  };

  const disconnect = () =>
    Alert.alert('Disconnect', `Forget ${server.host}:${server.port}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void forget() },
    ]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityLabel="Server settings" onPress={() => router.push('/connect')} hitSlop={12}>
              <Ionicons name="settings-outline" size={22} color={t.text} />
            </Pressable>
          ),
        }}
      />
      {snap.status === 'offline' ? (
        <Banner tone="danger" text={`Can't reach ${server.host}:${server.port}${snap.error ? ` — ${snap.error}` : ''}`} />
      ) : null}
      {snap.status === 'connecting' && !snap.robots.length ? <Muted>Connecting…</Muted> : null}

      {snap.robots.map((r) => (
        <Link key={r.serial} href={{ pathname: '/robot/[serial]', params: { serial: r.serial } }} asChild>
          <Pressable accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: t.text, fontSize: 19, fontWeight: '700', flexShrink: 1 }}>{r.name}</Text>
                <Battery level={r.battery} charging={r.isCharging} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {r.connected ? (
                  <>
                    <Pill text={r.state ? STATE_LABELS[r.state] : '…'} tone={r.state === 'error' ? 'danger' : r.state === 'cleaning' ? 'ok' : 'neutral'} />
                    {r.isDocked ? <Pill text="Docked" /> : null}
                  </>
                ) : (
                  <Pill text="Offline" tone="warn" />
                )}
                <Pill text={r.gen === 'neato.gen3' ? 'Gen 3' : 'Gen 4'} />
              </View>
            </Card>
          </Pressable>
        </Link>
      ))}

      {snap.status === 'online' && !snap.robots.length ? (
        <Card>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>No robots linked yet</Text>
          <Muted>Link a robot to your Vacuula server first, then pull down to refresh.</Muted>
        </Card>
      ) : null}

      <Muted>
        {server.host}:{server.port}
        {snap.server ? ` · Vacuula ${snap.server.version}` : ''}
      </Muted>
      <Btn label="Disconnect from server" onPress={disconnect} style={{ marginTop: 16 }} />
    </ScrollView>
  );
}
