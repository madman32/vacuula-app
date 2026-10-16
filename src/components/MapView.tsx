import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { G, Path, Polygon, Polyline } from 'react-native-svg';
import { RleMap, renderMap } from '../lib/maprender';
import { ZoneInfo } from '../lib/models';
import { useTheme } from '../theme';

/** Draws a floor map, an optional cleaning path and zone overlays. */
export function MapView({
  floor, run, zones, showZones = true,
}: { floor?: RleMap | null; run?: RleMap | null; zones?: ZoneInfo[]; showZones?: boolean }) {
  const t = useTheme();
  const rendered = useMemo(() => (floor || run ? renderMap(floor, run) : null), [floor, run]);
  if (!rendered) return null;
  const { viewBox: v, width, height } = rendered;
  const stroke = Math.max(1, v.w / 200);
  return (
    <View style={{ backgroundColor: t.mapBg, borderRadius: 12, overflow: 'hidden', aspectRatio: v.w / v.h, width: '100%' }}>
      <Svg width="100%" height="100%" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}>
        {rendered.layers.map((l, i) => (
          <Path key={i} d={l.d} fill={l.color} fillOpacity={l.opacity} />
        ))}
        {showZones && zones?.map((z) => {
          if (z.vertices.length < 2) return null;
          const color = z.color || (z.kind === 'nogo' ? '#ff5050' : '#5aa9ff');
          const pts = z.vertices.map(([x, y]) => `${x * width},${y * height}`).join(' ');
          const op = z.enabled ? 1 : 0.4;
          return (
            <G key={z.key} opacity={op}>
              {z.shape === 'polygon' && z.vertices.length >= 3 ? (
                <Polygon points={pts} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={stroke} />
              ) : (
                <Polyline points={pts} fill="none" stroke={color} strokeWidth={stroke * 1.5} />
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
