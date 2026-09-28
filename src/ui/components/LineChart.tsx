import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import type { Sample } from '../../services/telemetryHistory';
import { C, F } from '../theme';

interface Props {
  data: Sample[];
  color?: string;
  height?: number;
  unit?: string;
  digits?: number;
  fromT?: number; // left edge of the time window
  toT?: number;
  convert?: (v: number) => number;
  emptyText?: string;
}

const MAX_POINTS = 240;

function downsample(data: Sample[]): Sample[] {
  if (data.length <= MAX_POINTS) return data;
  const bucket = data.length / MAX_POINTS;
  const out: Sample[] = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    const slice = data.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket));
    if (!slice.length) continue;
    out.push({ t: slice[slice.length - 1].t, v: slice.reduce((a, s) => a + s.v, 0) / slice.length });
  }
  return out;
}

/** Lightweight SVG line chart. Draws only real samples; gaps > 5 s break the line. */
export function LineChart({ data, color = C.purple, height = 140, unit = '', digits = 1, fromT, toT, convert, emptyText = 'No samples yet' }: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const pts = useMemo(() => downsample(convert ? data.map((d) => ({ t: d.t, v: convert(d.v) })) : data), [data, convert]);
  const gid = useMemo(() => `lc${Math.random().toString(36).slice(2, 8)}`, []);

  const chart = useMemo(() => {
    if (pts.length < 2 || w === 0) return null;
    const t0 = fromT ?? pts[0].t;
    const t1 = Math.max(toT ?? pts[pts.length - 1].t, t0 + 1);
    let lo = Math.min(...pts.map((p) => p.v));
    let hi = Math.max(...pts.map((p) => p.v));
    if (hi - lo < 1e-6) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
    const x = (t: number) => ((t - t0) / (t1 - t0)) * w;
    const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
    let line = '';
    let area = '';
    let segStart = 0;
    pts.forEach((p, i) => {
      const gap = i > 0 && p.t - pts[i - 1].t > 5000;
      if (i === 0 || gap) {
        if (gap) area += `L${x(pts[i - 1].t)},${height} L${x(pts[segStart].t)},${height} Z `;
        line += `M${x(p.t)},${y(p.v)} `;
        area += `M${x(p.t)},${y(p.v)} `;
        segStart = i;
      } else {
        line += `L${x(p.t)},${y(p.v)} `;
        area += `L${x(p.t)},${y(p.v)} `;
      }
    });
    area += `L${x(pts[pts.length - 1].t)},${height} L${x(pts[segStart].t)},${height} Z`;
    return { line, area, lo: lo + pad, hi: hi - pad, last: pts[pts.length - 1].v };
  }, [pts, w, height, fromT, toT]);

  return (
    <View onLayout={onLayout} style={{ height: height + 18 }}>
      {chart ? (
        <>
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={0} x2={w} y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" />
            ))}
            <Path d={chart.area} fill={`url(#${gid})`} />
            <Path d={chart.line} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
          <View style={styles.axis}>
            <Text style={styles.axisText}>min {chart.lo.toFixed(digits)}{unit}</Text>
            <Text style={styles.axisText}>max {chart.hi.toFixed(digits)}{unit}</Text>
          </View>
        </>
      ) : (
        <View style={[styles.empty, { height }]}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { color: C.textFaint, fontSize: 10.5, fontFamily: F.mono },
  empty: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', get borderColor() { return C.border; } },
  emptyText: { color: C.textFaint, fontSize: 12.5 },
});
