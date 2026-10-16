import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Btn, Card, Field, Muted } from '../src/components/ui';
import { useVacuulaContext } from '../src/context';
import { useTheme } from '../src/theme';

export default function Connect() {
  const t = useTheme();
  const router = useRouter();
  const { server, connectTo } = useVacuulaContext();
  const [host, setHost] = useState(server?.host ?? '');
  const [port, setPort] = useState(String(server?.port ?? 80));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const h = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const p = parseInt(port, 10);
    if (!h) return setError('Enter the server address, e.g. 192.168.1.20');
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setError('Port must be between 1 and 65535');
    setBusy(true);
    setError(undefined);
    try {
      await connectTo(h, p);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Card title="Vacuula server">
          <Muted>
            Enter the address of the machine running your Vacuula server. Your phone must be on the same network
            (or have a route to it, e.g. over a VPN).
          </Muted>
          <Field label="Host or IP address" value={host} onChangeText={setHost} placeholder="192.168.1.20" keyboardType="url" />
          <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" />
          {error ? <Text style={{ color: t.danger, marginTop: 10 }}>{error}</Text> : null}
          <Btn kind="primary" label="Connect" onPress={submit} busy={busy} style={{ marginTop: 16 }} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
