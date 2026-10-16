import React, { useMemo, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, Text, View, useWindowDimensions,
} from 'react-native';
import Svg, { Circle, G, Path, Polygon, Polyline } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RleMap, renderMap } from '../lib/maprender';
import { Gen, ZoneInfo } from '../lib/models';
import {
  BOUNDARY_PRESETS, Boundary, KIND_LABELS, Point, ViewWindow, ZoneError, ZoneKind, availableKinds, buildBoundary, hitVertex,
  isClosed, minVertices, normalizeHex, pickUnusedPreset, screenToMap, zoomWindow,
} from '../lib/zones';
import { useTheme } from '../theme';
import { Btn, Chips, Field, Muted } from './ui';

const HIT_RADIUS = 30; // px
const TAP_SLOP = 8; // px
const ZOOMS = [1, 2, 3, 4, 6];

interface Props {
  visible: boolean;
  gen: Gen;
  floor: RleMap;
  /** Zone being edited; undefined to draw a new one. */
  existing?: ZoneInfo;
  /** All zones on the map (shown faded for context). */
  zones: ZoneInfo[];
  onCancel: () => void;
  onSave: (b: Boundary) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const kindFromZone = (z?: ZoneInfo): ZoneKind =>
  !z ? 'cleaning' : z.shape === 'polyline' ? 'nogo-line' : z.kind === 'nogo' ? 'nogo-zone' : 'cleaning';

export function ZoneEditor(props: Props) {
  // remount per session so state always starts from the zone being edited
  return props.visible ? <Editor key={props.existing?.id ?? 'new'} {...props} /> : null;
}

function Editor({ gen, floor, existing, zones, onCancel, onSave, onDelete }: Props) {
  const t = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const rendered = useMemo(() => renderMap(floor), [floor]);
  const base: ViewWindow = rendered.viewBox;
  const mapW = rendered.width, mapH = rendered.height;

  // View size: as wide as the screen allows, never taller than ~42% of it, same aspect as the cropped map.
  const aspect = base.w / base.h;
  const maxW = screenW - 32;
  const W = Math.min(maxW, screenH * 0.42 * aspect);
  const H = W / aspect;

  const kinds = availableKinds(gen);
  const [kind, setKind] = useState<ZoneKind>(kindFromZone(existing));
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(
    normalizeHex(existing?.color) ?? pickUnusedPreset(zones.map((z) => z.color ?? undefined)),
  );
  const [vertices, setVertices] = useState<Point[]>(existing ? existing.vertices.map((v) => [v[0], v[1]] as Point) : []);
  const [selected, setSelected] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([base.x + base.w / 2, base.y + base.h / 2]);
  const [panMode, setPanMode] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string>();

  const win = zoomWindow(base, zoom, center[0], center[1]);

  // Latest state for the (created-once) gesture handlers.
  const live = useRef({ vertices, win, panMode, W, H, mapW, mapH, base, zoom, center });
  live.current = { vertices, win, panMode, W, H, mapW, mapH, base, zoom, center };
  const drag = useRef({ x0: 0, y0: 0, idx: -1, moved: false, center0: [0, 0] as [number, number] });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const L = live.current;
        const { locationX: x, locationY: y } = e.nativeEvent;
        drag.current = {
          x0: x, y0: y, moved: false, center0: L.center,
          idx: L.panMode ? -1 : hitVertex(L.vertices, x, y, HIT_RADIUS, L.W, L.H, L.win, L.mapW, L.mapH),
        };
      },
      onPanResponderMove: (_e, g) => {
        const L = live.current, D = drag.current;
        if (Math.hypot(g.dx, g.dy) > TAP_SLOP) D.moved = true;
        if (!D.moved) return;
        if (L.panMode) {
          setCenter([D.center0[0] - g.dx * (L.win.w / L.W), D.center0[1] - g.dy * (L.win.h / L.H)]);
        } else if (D.idx >= 0) {
          const p = screenToMap(D.x0 + g.dx, D.y0 + g.dy, L.W, L.H, L.win, L.mapW, L.mapH);
          setVertices((vs) => vs.map((v, i) => (i === D.idx ? p : v)));
          setSelected(D.idx);
        }
      },
      onPanResponderRelease: () => {
        const L = live.current, D = drag.current;
        if (D.moved || L.panMode) return;
        if (D.idx >= 0) {
          setSelected(D.idx); // tap on a corner selects it
        } else {
          const p = screenToMap(D.x0, D.y0, L.W, L.H, L.win, L.mapW, L.mapH);
          setVertices((vs) => [...vs, p]);
          setSelected(L.vertices.length);
        }
        setError(undefined);
      },
    }),
  ).current;

  const changeZoom = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
    if (next === zoom) return;
    // zoom in around the selected corner (or the shape's last point) so you can fine-tune it
    const focus = vertices[selected] ?? vertices[vertices.length - 1];
    if (dir === 1 && focus) setCenter([focus[0] * mapW, focus[1] * mapH]);
    setZoom(next);
  };

  const removeVertex = () => {
    if (!vertices.length) return;
    const idx = selected >= 0 && selected < vertices.length ? selected : vertices.length - 1;
    setVertices(vertices.filter((_, i) => i !== idx));
    setSelected(-1);
    setError(undefined);
  };

  const k = win.w / W; // map cells per screen pixel
  const closed = isClosed(kind);
  const pts = vertices.map((v) => `${v[0] * mapW},${v[1] * mapH}`).join(' ');
  const need = minVertices(kind);
  const accent = normalizeHex(color) ?? BOUNDARY_PRESETS[0];

  const save = async () => {
    setError(undefined);
    let b: Boundary;
    try {
      b = buildBoundary({
        id: existing?.id, name, color, kind, vertices, enabled: existing?.enabled ?? true, gen,
        existingCount: zones.length,
      });
    } catch (e) {
      setError(e instanceof ZoneError ? e.message : (e as Error).message);
      return;
    }
    setBusy('save');
    try {
      await onSave(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () =>
    Alert.alert('Delete zone', `Delete “${existing?.name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try { await onDelete?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
        },
      },
    ]);

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>{existing ? 'Edit zone' : 'Draw a zone'}</Text>
            <Muted>
              {panMode
                ? 'Pan mode: drag to move the map.'
                : closed
                  ? 'Tap to add corners. Drag a corner to move it.'
                  : 'Tap to add points along the line. Drag a point to move it.'}
            </Muted>

            <View
              {...pan.panHandlers}
              style={{ width: W, height: H, alignSelf: 'center', marginTop: 8, borderRadius: 12, overflow: 'hidden', backgroundColor: t.mapBg }}
            >
              <Svg width={W} height={H} viewBox={`${win.x} ${win.y} ${win.w} ${win.h}`} pointerEvents="none">
                {rendered.layers.map((l, i) => (
                  <Path key={i} d={l.d} fill={l.color} fillOpacity={l.opacity} />
                ))}
                {zones.filter((z) => z.id !== existing?.id && z.vertices.length > 1).map((z) => {
                  const c = z.color || (z.kind === 'nogo' ? '#ff5050' : '#5aa9ff');
                  const p = z.vertices.map(([x, y]) => `${x * mapW},${y * mapH}`).join(' ');
                  return (
                    <G key={z.key} opacity={0.35}>
                      {z.shape === 'polygon' && z.vertices.length >= 3
                        ? <Polygon points={p} fill={c} fillOpacity={0.25} stroke={c} strokeWidth={k * 1.5} />
                        : <Polyline points={p} fill="none" stroke={c} strokeWidth={k * 2} />}
                    </G>
                  );
                })}
                {vertices.length > 1 ? (
                  closed && vertices.length >= 3
                    ? <Polygon points={pts} fill={accent} fillOpacity={0.3} stroke={accent} strokeWidth={k * 2.5} />
                    : <Polyline points={pts} fill="none" stroke={accent} strokeWidth={k * 2.5} />
                ) : null}
                {vertices.map((v, i) => (
                  <Circle
                    key={i} cx={v[0] * mapW} cy={v[1] * mapH} r={k * (i === selected ? 11 : 8)}
                    fill={i === selected ? '#ffffff' : accent} stroke={i === selected ? accent : '#ffffff'} strokeWidth={k * 2}
                  />
                ))}
              </Svg>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center' }}>
              <Btn label={panMode ? 'Draw' : 'Pan'} onPress={() => setPanMode((p) => !p)} style={{ minWidth: 70 }} />
              <Btn label="−" onPress={() => changeZoom(-1)} disabled={zoom === ZOOMS[0]} style={{ minWidth: 48 }} />
              <View style={{ justifyContent: 'center' }}><Text style={{ color: t.sub, fontWeight: '700' }}>{zoom}×</Text></View>
              <Btn label="+" onPress={() => changeZoom(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} style={{ minWidth: 48 }} />
              <Btn label={selected >= 0 ? 'Remove point' : 'Undo'} onPress={removeVertex} disabled={!vertices.length} />
              <Btn label="Clear" onPress={() => { setVertices([]); setSelected(-1); }} disabled={!vertices.length} />
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            <Field label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" placeholder={`${KIND_LABELS[kind]} ${zones.length + 1}`} />
            {kinds.length > 1 ? (
              <Chips
                label="Type" options={kinds.map((x) => ({ value: x, label: KIND_LABELS[x] }))} value={kind}
                onChange={(x) => { setKind(x); setError(undefined); }}
              />
            ) : null}
            <Text style={{ color: t.sub, fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6 }}>Colour</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {BOUNDARY_PRESETS.map((c) => (
                <Pressable
                  key={c} accessibilityLabel={`Colour ${c}`} onPress={() => setColor(c)}
                  style={{
                    width: 34, height: 34, borderRadius: 17, backgroundColor: c,
                    borderWidth: c === accent ? 3 : 0, borderColor: t.text,
                  }}
                />
              ))}
            </View>
            {vertices.length < need ? (
              <Muted>{closed ? 'A zone needs at least 3 corners' : 'A line needs at least 2 points'} ({vertices.length} so far).</Muted>
            ) : null}
            {error ? <Text style={{ color: t.danger, marginTop: 10 }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Btn flex label="Cancel" onPress={onCancel} disabled={busy !== null} />
              <Btn flex kind="primary" label="Save" onPress={save} busy={busy === 'save'} disabled={vertices.length < need || busy !== null} />
            </View>
            {existing && onDelete ? (
              <Btn kind="danger" label="Delete zone" onPress={confirmDelete} busy={busy === 'delete'} disabled={busy !== null} style={{ marginTop: 8 }} />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
