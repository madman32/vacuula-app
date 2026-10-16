import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, StyleProp, StyleSheet, Switch, Text, TextInput, View, ViewStyle,
} from 'react-native';
import { Theme, useTheme } from '../theme';

export function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }, style]}>
      {title ? <Text style={[s.cardTitle, { color: t.sub }]}>{title.toUpperCase()}</Text> : null}
      {children}
    </View>
  );
}

export function Btn({
  label, onPress, kind = 'secondary', disabled, busy, style, flex,
}: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; flex?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.primary : kind === 'danger' ? t.danger : t.chip;
  const fg = kind === 'secondary' ? t.text : kind === 'primary' ? t.onPrimary : '#fff';
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button" onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: off ? 0.4 : pressed ? 0.8 : 1 }, flex && { flex: 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chips<T extends string>({
  options, value, onChange, multi, label,
}: {
  options: { value: T; label: string }[]; value: T | T[]; onChange: (v: T) => void; multi?: boolean; label?: string;
}) {
  const t = useTheme();
  const active = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <View style={{ marginTop: 8 }}>
      {label ? <Text style={[s.label, { color: t.sub }]}>{label}</Text> : null}
      <View style={s.chipRow}>
        {options.map((o) => (
          <Pressable
            key={o.value} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ selected: active(o.value) }}
            onPress={() => onChange(o.value)}
            style={[s.chip, { backgroundColor: active(o.value) ? t.chipActive : t.chip }]}
          >
            <Text style={{ color: active(o.value) ? t.onPrimary : t.chipText, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function SwitchRow({
  label, hint, value, onValueChange, disabled,
}: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={s.switchRow}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
        {hint ? <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: t.primary }} />
    </View>
  );
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  const t = useTheme();
  const color = tone === 'ok' ? t.ok : tone === 'warn' ? t.warn : tone === 'danger' ? t.danger : t.sub;
  return (
    <View style={[s.pill, { borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Banner({ text, tone = 'warn' }: { text: string; tone?: 'warn' | 'danger' }) {
  const t = useTheme();
  const c = tone === 'danger' ? t.danger : t.warn;
  return (
    <View style={[s.banner, { borderColor: c, backgroundColor: t.card }]}>
      <Text style={{ color: c, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.sub, fontSize: 14, marginTop: 6 }}>{children}</Text>;
}

export function Battery({ level, charging }: { level?: number; charging?: boolean }) {
  const t = useTheme();
  const pct = level ?? 0;
  const color = pct <= 15 ? t.danger : pct <= 35 ? t.warn : t.ok;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={[s.batt, { borderColor: t.sub }]}>
        <View style={{ width: `${Math.max(4, pct)}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={{ color: t.text, marginLeft: 8, fontWeight: '600' }}>{level === undefined ? '–' : `${level}%`}{charging ? ' ⚡' : ''}</Text>
    </View>
  );
}

/** Cross-platform text prompt (Alert.prompt is iOS-only). */
export function PromptModal({
  visible, title, initial, keyboardType, onSubmit, onCancel,
}: {
  visible: boolean; title: string; initial?: string; keyboardType?: 'default' | 'numbers-and-punctuation';
  onSubmit: (v: string) => void; onCancel: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState(initial ?? '');
  React.useEffect(() => { if (visible) setText(initial ?? ''); }, [visible, initial]);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={s.modalBack}>
        <View style={[s.modal, { backgroundColor: t.card }]}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>{title}</Text>
          <TextInput
            value={text} onChangeText={setText} autoFocus keyboardType={keyboardType} onSubmitEditing={() => onSubmit(text)}
            style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Btn flex label="Cancel" onPress={onCancel} />
            <Btn flex kind="primary" label="Save" onPress={() => onSubmit(text)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.label, { color: t.sub }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.sub} autoCapitalize="none" autoCorrect={false}
        style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }, style]} {...rest}
      />
    </View>
  );
}

/** Run an async action with a busy flag and an error alert. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export const styles = (t: Theme) => StyleSheet.create({ screen: { flex: 1, backgroundColor: t.bg } });

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  btn: { minHeight: 46, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginRight: 6, marginTop: 6 },
  banner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  batt: { width: 34, height: 16, borderWidth: 1.5, borderRadius: 4, padding: 1.5, overflow: 'hidden' },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modal: { borderRadius: 16, padding: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
