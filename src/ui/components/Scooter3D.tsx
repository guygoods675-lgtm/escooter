import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { modelById } from '../../data/scooterDatabase';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { useThemeVersion } from '../../store/theme';
import { useScooterTitle } from '../hooks';
import { C, R, S, rgba } from '../theme';
import { GlassCard, SectionHeader } from './Glass';

/**
 * Generic electric-scooter visualisation drawn without native GL: a small
 * procedural low-poly mesh, projected with a perspective camera and painted
 * back-to-front as SVG polygons with Lambert shading tinted by the accent.
 *
 * It is not a model of any specific scooter. When `live` is on, only values the
 * scooter actually reports drive it (wheel speed, headlight, brake/tail light,
 * battery %). Nothing is lit or spinning without real data.
 */

// ---------------------------------------------------------------- geometry
type V3 = [number, number, number];
type Group = 0 | 1 | 2; // 0 static, 1 front wheel, 2 rear wheel
type Tag = 'body' | 'trim' | 'tire' | 'tireAlt' | 'hub' | 'spoke' | 'grip' | 'deckTop' | 'headlight' | 'tail' | 'indicator' | `batt${number}`;

interface Face {
  idx: number[];
  n: V3; // outward normal, model space
  tag: Tag;
  group: Group;
  twoSided: boolean;
}

interface Mesh {
  verts: V3[];
  vgroup: Group[];
  faces: Face[];
  wheelCenter: [V3, V3]; // front, rear
  wheelR: number;
  headlight: V3;
  headlightN: V3;
  tail: V3;
  indicators: V3[];
  battSegments: number;
}

export interface ScooterShape {
  wheelRadius: number; // visual metres
  deckLength: number;
  stemHeight: number;
  deckWidth: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};

/** Builds the mesh. x = forward, y = up, z = right. */
export function buildScooterMesh(shape: ScooterShape): Mesh {
  const verts: V3[] = [];
  const vgroup: Group[] = [];
  const faces: Face[] = [];

  const poly = (pts: V3[], tag: Tag, group: Group, inside: V3 | null, twoSided = false) => {
    const idx = pts.map((p) => {
      verts.push(p);
      vgroup.push(group);
      return verts.length - 1;
    });
    // Newell normal
    let n: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    n = unit(n);
    if (inside) {
      const c = pts.reduce<V3>((s, p) => add(s, p), [0, 0, 0]).map((v) => v / pts.length) as V3;
      if (dot(n, sub(c, inside)) < 0) n = mul(n, -1);
    }
    faces.push({ idx, n, tag, group, twoSided });
  };

  /** Box around a segment a→b, cross-section w (along `side`) × d. */
  const beam = (a: V3, b: V3, w: number, d: number, tag: Tag, group: Group = 0, side: V3 = [0, 0, 1]) => {
    const u = unit(sub(b, a));
    const s = unit(side);
    const t = unit(cross(u, s));
    const corners = (p: V3): V3[] => [
      add(add(p, mul(s, w / 2)), mul(t, d / 2)),
      add(add(p, mul(s, -w / 2)), mul(t, d / 2)),
      add(add(p, mul(s, -w / 2)), mul(t, -d / 2)),
      add(add(p, mul(s, w / 2)), mul(t, -d / 2)),
    ];
    const A = corners(a);
    const B = corners(b);
    const mid = mul(add(a, b), 0.5);
    poly(A, tag, group, mid);
    poly(B, tag, group, mid);
    for (let i = 0; i < 4; i++) poly([A[i], A[(i + 1) % 4], B[(i + 1) % 4], B[i]], tag, group, mid);
  };

  /** Cylinder along axis direction (unit) centred at c. */
  const cylinder = (c: V3, axis: V3, r: number, half: number, seg: number, tag: Tag, group: Group = 0, capTag?: Tag) => {
    const ax = unit(axis);
    const e1 = unit(Math.abs(ax[1]) < 0.9 ? cross(ax, [0, 1, 0]) : cross(ax, [1, 0, 0]));
    const e2 = cross(ax, e1);
    const ring = (off: number) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return add(add(c, mul(ax, off)), add(mul(e1, Math.cos(a) * r), mul(e2, Math.sin(a) * r)));
    });
    const A = ring(-half);
    const B = ring(half);
    for (let i = 0; i < seg; i++) poly([A[i], A[(i + 1) % seg], B[(i + 1) % seg], B[i]], tag, group, c);
    poly(A, capTag ?? tag, group, c);
    poly(B, capTag ?? tag, group, c);
  };

  // --- proportions
  const r = shape.wheelRadius;
  const wheelBase = shape.deckLength + r * 2 + 0.12;
  const front: V3 = [wheelBase / 2, r, 0];
  const rear: V3 = [-wheelBase / 2, r, 0];

  // --- wheels: torus tyre + hub + spokes
  const wheel = (c: V3, group: Group) => {
    const segU = 16;
    const segV = 6;
    const minor = r * 0.26;
    const major = r - minor;
    const pt = (u: number, v: number): V3 => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const rr = major + minor * Math.cos(v);
      return [c[0] + rr * cu, c[1] + rr * su, c[2] + minor * Math.sin(v)];
    };
    for (let i = 0; i < segU; i++) {
      const u0 = (i / segU) * Math.PI * 2;
      const u1 = ((i + 1) / segU) * Math.PI * 2;
      const ringC: V3 = [c[0] + major * Math.cos((u0 + u1) / 2), c[1] + major * Math.sin((u0 + u1) / 2), c[2]];
      for (let j = 0; j < segV; j++) {
        const v0 = (j / segV) * Math.PI * 2;
        const v1 = ((j + 1) / segV) * Math.PI * 2;
        poly([pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)], i % 2 ? 'tire' : 'tireAlt', group, ringC);
      }
    }
    cylinder(c, [0, 0, 1], r * 0.34, 0.028, 12, 'hub', group, 'trim');
    const spokes = 5;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      const from: V3 = [c[0] + Math.cos(a) * r * 0.3, c[1] + Math.sin(a) * r * 0.3, c[2]];
      const to: V3 = [c[0] + Math.cos(a) * (major - minor * 0.6), c[1] + Math.sin(a) * (major - minor * 0.6), c[2]];
      beam(from, to, 0.022, r * 0.16, 'spoke', group);
    }
  };
  wheel(front, 1);
  wheel(rear, 2);

  // --- deck
  const deckY0 = r * 0.55;
  const deckY1 = deckY0 + 0.055;
  const dl = shape.deckLength / 2;
  const dw = shape.deckWidth / 2;
  const deckFront = dl;
  const deckRear = -dl;
  const deckInside: V3 = [0, (deckY0 + deckY1) / 2, 0];
  // deck as a box with a chamfered front
  const top: V3[] = [
    [deckRear, deckY1, -dw], [deckFront - 0.04, deckY1, -dw], [deckFront - 0.04, deckY1, dw], [deckRear, deckY1, dw],
  ];
  const bot: V3[] = [
    [deckRear + 0.03, deckY0, -dw + 0.01], [deckFront, deckY0, -dw + 0.01], [deckFront, deckY0, dw - 0.01], [deckRear + 0.03, deckY0, dw - 0.01],
  ];
  // top split into slices so the painter's sort keeps the battery strip above it
  const slices = 12;
  for (let k = 0; k < slices; k++) {
    const x0 = deckRear + ((deckFront - 0.04 - deckRear) * k) / slices;
    const x1 = deckRear + ((deckFront - 0.04 - deckRear) * (k + 1)) / slices;
    poly([[x0, deckY1, -dw], [x1, deckY1, -dw], [x1, deckY1, dw], [x0, deckY1, dw]], 'deckTop', 0, deckInside);
  }
  poly(bot, 'body', 0, deckInside);
  for (let i = 0; i < 4; i++) poly([top[i], top[(i + 1) % 4], bot[(i + 1) % 4], bot[i]], i % 2 === 0 ? 'trim' : 'body', 0, deckInside);

  // battery indicator strip on the deck (10 segments), slightly raised
  const battSegments = 10;
  const stripY = deckY1 + 0.004;
  const sx0 = deckRear + 0.08;
  const sx1 = deckFront - 0.12;
  const segLen = (sx1 - sx0) / battSegments;
  for (let k = 0; k < battSegments; k++) {
    const a = sx0 + k * segLen + 0.004;
    const b = sx0 + (k + 1) * segLen - 0.004;
    poly([[a, stripY, -0.026], [b, stripY, -0.026], [b, stripY, 0.026], [a, stripY, 0.026]], `batt${k}`, 0, [0, deckY0, 0]);
  }

  // --- neck from deck to steering head, stem with rake, fork
  const headBottom: V3 = [front[0] - 0.05, deckY1 + 0.12, 0];
  const headTop: V3 = [front[0] - 0.12, deckY1 + shape.stemHeight, 0];
  beam([deckFront - 0.05, (deckY0 + deckY1) / 2, 0], headBottom, 0.05, 0.05, 'body');
  beam(headBottom, headTop, 0.045, 0.045, 'body');
  // fork legs to the front axle
  beam(headBottom, [front[0], front[1], -0.05], 0.018, 0.03, 'trim', 0, [1, 0, 0]);
  beam(headBottom, [front[0], front[1], 0.05], 0.018, 0.03, 'trim', 0, [1, 0, 0]);
  // rear dropouts
  beam([deckRear + 0.02, deckY0 + 0.02, -0.05], [rear[0], rear[1], -0.05], 0.02, 0.03, 'trim', 0, [0, 0, 1]);
  beam([deckRear + 0.02, deckY0 + 0.02, 0.05], [rear[0], rear[1], 0.05], 0.02, 0.03, 'trim', 0, [0, 0, 1]);

  // --- handlebar + grips + bar-end indicators
  const barHalf = 0.26;
  cylinder(headTop, [0, 0, 1], 0.014, barHalf, 8, 'body');
  cylinder([headTop[0], headTop[1], barHalf - 0.06], [0, 0, 1], 0.021, 0.06, 8, 'grip');
  cylinder([headTop[0], headTop[1], -barHalf + 0.06], [0, 0, 1], 0.021, 0.06, 8, 'grip');
  const indL: V3 = [headTop[0], headTop[1], -barHalf - 0.012];
  const indR: V3 = [headTop[0], headTop[1], barHalf + 0.012];
  cylinder(indL, [0, 0, 1], 0.016, 0.012, 8, 'indicator');
  cylinder(indR, [0, 0, 1], 0.016, 0.012, 8, 'indicator');

  // --- headlight on the stem, facing forward
  const hlC: V3 = [headTop[0] + 0.03, headTop[1] - 0.12, 0];
  beam([hlC[0] - 0.03, hlC[1], 0], [hlC[0] + 0.012, hlC[1], 0], 0.05, 0.035, 'trim', 0, [0, 0, 1]);
  poly([[hlC[0] + 0.013, hlC[1] - 0.015, -0.022], [hlC[0] + 0.013, hlC[1] - 0.015, 0.022], [hlC[0] + 0.013, hlC[1] + 0.015, 0.022], [hlC[0] + 0.013, hlC[1] + 0.015, -0.022]], 'headlight', 0, hlC);

  // --- rear fender (two-sided strip) + tail light
  const fenderR = r + 0.018;
  const fSeg = 8;
  const a0 = Math.PI * 0.12;
  const a1 = Math.PI * 0.95;
  for (let i = 0; i < fSeg; i++) {
    const u0 = a0 + ((a1 - a0) * i) / fSeg;
    const u1 = a0 + ((a1 - a0) * (i + 1)) / fSeg;
    const p = (u: number, z: number): V3 => [rear[0] + Math.cos(u) * fenderR, rear[1] + Math.sin(u) * fenderR, z];
    poly([p(u0, -0.04), p(u1, -0.04), p(u1, 0.04), p(u0, 0.04)], 'trim', 0, rear, true);
  }
  // front mudguard
  for (let i = 0; i < 5; i++) {
    const u0 = Math.PI * 0.2 + (Math.PI * 0.55 * i) / 5;
    const u1 = Math.PI * 0.2 + (Math.PI * 0.55 * (i + 1)) / 5;
    const p = (u: number, z: number): V3 => [front[0] + Math.cos(u) * fenderR, front[1] + Math.sin(u) * fenderR, z];
    poly([p(u0, -0.035), p(u1, -0.035), p(u1, 0.035), p(u0, 0.035)], 'body', 0, front, true);
  }
  const tailAngle = a1;
  const tailC: V3 = [rear[0] + Math.cos(tailAngle) * fenderR - 0.004, rear[1] + Math.sin(tailAngle) * fenderR, 0];
  beam([tailC[0] + 0.012, tailC[1], 0], [tailC[0] - 0.01, tailC[1], 0], 0.05, 0.022, 'tail', 0, [0, 0, 1]);

  return {
    verts,
    vgroup,
    faces,
    wheelCenter: [front, rear],
    wheelR: r,
    headlight: [hlC[0] + 0.02, hlC[1], 0],
    headlightN: [1, 0, 0],
    tail: [tailC[0] - 0.012, tailC[1], 0],
    indicators: [indL, indR],
    battSegments,
  };
}

// ---------------------------------------------------------------- model family / wheel size
export const DEFAULT_WHEEL_IN = 8.5;
/** First inch figure in the database's wheel size text (e.g. '8.5"' or '8" front / 7.5" rear'). */
export function parseWheelInches(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*(?:"|in|inch)/i.exec(s);
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) && v > 4 && v < 20 ? v : null;
}

export function useScooterShape() {
  const { brand, model, profile } = useScooterTitle();
  const dbModel = modelById(profile?.modelId ?? null);
  const wheelIn = parseWheelInches(dbModel?.wheelSize);
  return useMemo(() => {
    const inches = wheelIn ?? DEFAULT_WHEEL_IN;
    const fam = `${brand ?? ''} ${model ?? ''}`.toLowerCase();
    const ninebot = /ninebot|segway/.test(fam);
    const shape: ScooterShape = {
      // drawn ~20% larger than life so the wheels read well at phone size (visual only)
      wheelRadius: Math.max(0.1, Math.min(0.18, ((inches * 0.0254) / 2) * 1.2)),
      deckLength: ninebot ? 0.58 : 0.52,
      deckWidth: ninebot ? 0.17 : 0.15,
      stemHeight: 0.92,
    };
    return {
      shape,
      wheelInches: inches,
      wheelFromDatabase: wheelIn != null,
      // real rolling circumference in metres, used for wheel spin rate
      circumferenceM: Math.PI * inches * 0.0254,
    };
  }, [brand, model, wheelIn]);
}

// ---------------------------------------------------------------- camera
interface Cam {
  yaw: number;
  pitch: number;
  dist: number;
}
const DEFAULT_CAM: Cam = { yaw: 0.85, pitch: 0.38, dist: 2.3 };
const MIN_DIST = 1.2;
const MAX_DIST = 4.5;
const clampPitch = (p: number) => Math.max(-0.35, Math.min(1.35, p));

function hexRgb(hex: string): V3 {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

interface LiveVisual {
  speedKmh: number | null;
  headlight: boolean;
  tail: boolean;
  brake: boolean;
  battery: number | null; // 0-100 or null
}
const NO_LIVE: LiveVisual = { speedKmh: null, headlight: false, tail: false, brake: false, battery: null };

interface RenderedPath {
  d: string;
  fill: string;
}
interface Frame {
  paths: RenderedPath[];
  headGlow: { x: number; y: number; r: number } | null;
  tailGlow: { x: number; y: number; r: number; strong: boolean } | null;
}

/** Projects and paints the mesh for one camera/wheel state. */
function renderFrame(mesh: Mesh, cam: Cam, w: number, h: number, wheelAngle: number, live: LiveVisual, accent: string, blur: boolean): Frame {
  const target: V3 = [0, 0.42, 0];
  const cp = Math.cos(cam.pitch);
  const pos: V3 = [target[0] + cam.dist * cp * Math.sin(cam.yaw), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * cp * Math.cos(cam.yaw)];
  const fwd = unit(sub(target, pos));
  const right = unit(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const f = Math.min(w, h * 1.25) * 1.25;
  const cx = w / 2;
  const cy = h / 2;
  // light from upper-left of the viewer
  const L = unit(add(add(mul(fwd, -0.55), mul(up, 0.7)), mul(right, -0.45)));

  const cosA = Math.cos(-wheelAngle);
  const sinA = Math.sin(-wheelAngle);
  const n = mesh.verts.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const wx = new Float32Array(n);
  const wy = new Float32Array(n);
  const wz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = mesh.verts[i];
    const g = mesh.vgroup[i];
    if (g) {
      const c = mesh.wheelCenter[g - 1];
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      p = [c[0] + dx * cosA - dy * sinA, c[1] + dx * sinA + dy * cosA, p[2]];
    }
    wx[i] = p[0];
    wy[i] = p[1];
    wz[i] = p[2];
    const rx = p[0] - pos[0];
    const ry = p[1] - pos[1];
    const rz = p[2] - pos[2];
    const zc = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
    const xc = rx * right[0] + ry * right[1] + rz * right[2];
    const yc = rx * up[0] + ry * up[1] + rz * up[2];
    sz[i] = zc;
    sx[i] = cx + (f * xc) / Math.max(zc, 0.05);
    sy[i] = cy - (f * yc) / Math.max(zc, 0.05);
  }

  const acc = hexRgb(accent);
  const base: Record<string, V3> = {
    body: mix([78, 76, 92], acc, 0.4),
    trim: mix([110, 108, 124], acc, 0.6),
    tire: [38, 37, 44],
    tireAlt: [52, 51, 60],
    hub: [120, 118, 132],
    spoke: mix([150, 148, 160], acc, 0.25),
    grip: [30, 30, 34],
    deckTop: [40, 39, 48],
    headlight: [120, 120, 110],
    tail: [90, 30, 34],
    indicator: [90, 70, 30],
  };
  const battLit = Math.round(((live.battery ?? 0) / 100) * mesh.battSegments);
  const battColor: V3 = live.battery == null ? [80, 80, 88] : live.battery <= 15 ? hexRgb(C.red) : live.battery <= 30 ? hexRgb(C.amber) : hexRgb(C.green);

  type Vis = { face: Face; depth: number; fill: string };
  const vis: Vis[] = [];
  for (const face of mesh.faces) {
    if (blur && face.tag === 'spoke') continue;
    let nrm = face.n;
    if (face.group) nrm = [face.n[0] * cosA - face.n[1] * sinA, face.n[0] * sinA + face.n[1] * cosA, face.n[2]];
    let mx = 0;
    let my = 0;
    let mz = 0;
    let depth = 0;
    let behind = false;
    for (const i of face.idx) {
      mx += wx[i];
      my += wy[i];
      mz += wz[i];
      depth += sz[i];
      if (sz[i] < 0.06) behind = true;
    }
    if (behind) continue;
    const k = face.idx.length;
    const toCam: V3 = [pos[0] - mx / k, pos[1] - my / k, pos[2] - mz / k];
    let facing = dot(nrm, toCam);
    if (facing <= 0) {
      if (!face.twoSided) continue;
      nrm = mul(nrm, -1);
      facing = -facing;
    }
    const lam = Math.max(0, dot(nrm, L));
    // quantised so neighbouring faces merge into one path
    const shade = Math.round((0.4 + 0.75 * lam) * 14) / 14;
    let rgb: V3;
    let emissive = false;
    const tag = face.tag;
    if (tag === 'headlight' && live.headlight) {
      rgb = [255, 247, 214];
      emissive = true;
    } else if (tag === 'tail' && (live.brake || live.tail)) {
      rgb = live.brake ? [255, 50, 60] : [200, 40, 50];
      emissive = true;
    } else if (tag.startsWith('batt')) {
      const seg = parseInt(tag.slice(4), 10);
      rgb = live.battery != null && seg < battLit ? battColor : live.battery == null ? [70, 70, 78] : [40, 40, 48];
      emissive = live.battery != null && seg < battLit;
    } else {
      rgb = base[tag] ?? base.body;
    }
    const col = emissive ? rgb : mul(rgb, shade).map((v) => Math.min(255, v));
    // small bias: the battery strip sits a few mm above the deck and must paint after it
    vis.push({ face, depth: depth / k - (tag.startsWith('batt') ? 0.03 : 0), fill: `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})` });
  }
  vis.sort((a, b) => b.depth - a.depth);

  const paths: RenderedPath[] = [];
  let cur: RenderedPath | null = null;
  for (const v of vis) {
    let d = '';
    v.face.idx.forEach((i, j) => {
      d += `${j ? 'L' : 'M'}${sx[i].toFixed(1)} ${sy[i].toFixed(1)}`;
    });
    d += 'Z';
    if (cur && cur.fill === v.fill) cur.d += d;
    else {
      cur = { d, fill: v.fill };
      paths.push(cur);
    }
  }

  const project = (p: V3) => {
    const rx = p[0] - pos[0];
    const ry = p[1] - pos[1];
    const rz = p[2] - pos[2];
    const zc = Math.max(0.05, rx * fwd[0] + ry * fwd[1] + rz * fwd[2]);
    return { x: cx + (f * (rx * right[0] + ry * right[1] + rz * right[2])) / zc, y: cy - (f * (rx * up[0] + ry * up[1] + rz * up[2])) / zc, z: zc };
  };
  let headGlow: Frame['headGlow'] = null;
  if (live.headlight && dot(mesh.headlightN, sub(pos, mesh.headlight)) > 0) {
    const p = project(mesh.headlight);
    headGlow = { x: p.x, y: p.y, r: (f * 0.09) / p.z };
  }
  let tailGlow: Frame['tailGlow'] = null;
  if ((live.brake || live.tail) && dot([-1, 0, 0], sub(pos, mesh.tail)) > 0) {
    const p = project(mesh.tail);
    tailGlow = { x: p.x, y: p.y, r: (f * (live.brake ? 0.08 : 0.05)) / p.z, strong: live.brake };
  }
  return { paths, headGlow, tailGlow };
}

// ---------------------------------------------------------------- component
export interface Scooter3DHandle {
  resetCamera(): void;
}

interface Props {
  height?: number;
  interactive?: boolean;
  live?: boolean;
  /** Show the built-in reset button (default: when interactive). */
  showReset?: boolean;
  ref?: React.Ref<Scooter3DHandle>;
}

const FRAME_MS = 33; // ≤ 30 fps
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Scooter3D({ height = 300, interactive = true, live = true, showReset, ref }: Props) {
  useThemeVersion();
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const { title } = useScooterTitle();
  const { shape, circumferenceM } = useScooterShape();
  const mesh = useMemo(() => buildScooterMesh(shape), [shape]);
  const [width, setWidth] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);

  const cam = useRef<Cam>({ ...DEFAULT_CAM });
  const vel = useRef({ yaw: 0, pitch: 0 });
  const dragging = useRef(false);
  const ease = useRef<{ from: Cam; to: Cam; start: number; dur: number } | null>(null);
  const wheelAngle = useRef(0);
  const liveRef = useRef<LiveVisual>(NO_LIVE);
  const raf = useRef<number | null>(null);
  const lastT = useRef(0);
  const lastDraw = useRef(0);
  const dims = useRef({ w: 0, h: height });
  const meshRef = useRef(mesh);
  meshRef.current = mesh;
  const circRef = useRef(circumferenceM);
  circRef.current = circumferenceM;
  const accentRef = useRef(C.purple);
  accentRef.current = C.purple;
  dims.current = { w: width, h: height };

  const draw = useCallback(() => {
    const { w, h } = dims.current;
    if (!w) return;
    const lv = liveRef.current;
    const radPerSec = lv.speedKmh != null && lv.speedKmh > 0 ? (lv.speedKmh / 3.6 / circRef.current) * Math.PI * 2 : 0;
    // spokes alias badly once they move more than ~a third of the spoke gap per frame; show a blur disc instead
    const blur = (radPerSec * FRAME_MS) / 1000 > 0.45;
    setFrame(renderFrame(meshRef.current, cam.current, w, h, wheelAngle.current, lv, accentRef.current, blur));
  }, []);

  const tick = useCallback(() => {
    raf.current = null;
    const now = Date.now();
    const dt = Math.min(0.1, (now - (lastT.current || now)) / 1000);
    lastT.current = now;
    let busy = false;
    const e = ease.current;
    if (e) {
      const k = Math.min(1, (now - e.start) / e.dur);
      const t = easeInOut(k);
      cam.current = { yaw: e.from.yaw + (e.to.yaw - e.from.yaw) * t, pitch: e.from.pitch + (e.to.pitch - e.from.pitch) * t, dist: e.from.dist + (e.to.dist - e.from.dist) * t };
      if (k >= 1) ease.current = null;
      busy = true;
    } else if (!dragging.current && (Math.abs(vel.current.yaw) > 0.01 || Math.abs(vel.current.pitch) > 0.01)) {
      cam.current.yaw += vel.current.yaw * dt;
      cam.current.pitch = clampPitch(cam.current.pitch + vel.current.pitch * dt);
      const damp = Math.exp(-dt * 3.5);
      vel.current.yaw *= damp;
      vel.current.pitch *= damp;
      busy = true;
    }
    const lv = liveRef.current;
    if (lv.speedKmh != null && lv.speedKmh > 0.3) {
      wheelAngle.current = (wheelAngle.current + (lv.speedKmh / 3.6 / circRef.current) * Math.PI * 2 * dt) % (Math.PI * 2);
      busy = true;
    }
    if (dragging.current) busy = true;
    if (now - lastDraw.current >= FRAME_MS) {
      lastDraw.current = now;
      draw();
    }
    if (busy) raf.current = requestAnimationFrame(tick);
    else {
      lastT.current = 0;
      draw();
    }
  }, [draw]);

  const kick = useCallback(() => {
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );

  // redraw on size/mesh/accent change
  const accentNow = C.purple;
  useEffect(() => {
    kick();
  }, [width, height, mesh, accentNow, kick]);

  // live data → ref (no React re-render per packet)
  useEffect(() => {
    if (!live) {
      liveRef.current = NO_LIVE;
      kick();
      return;
    }
    const pick = (s: ReturnType<typeof useLive.getState>): LiveVisual => {
      if (s.conn !== 'connected' || !s.snapshot) return NO_LIVE;
      const snap = s.snapshot;
      return {
        speedKmh: snap.speedKmh ? Math.max(0, snap.speedKmh.value) : null,
        headlight: snap.headlight?.value === true,
        tail: snap.tailLight?.value === true,
        brake: snap.brake?.value === true,
        battery: snap.batteryPercent ? Math.max(0, Math.min(100, snap.batteryPercent.value)) : null,
      };
    };
    liveRef.current = pick(useLive.getState());
    kick();
    return useLive.subscribe((s) => {
      const n = pick(s);
      const o = liveRef.current;
      liveRef.current = n;
      if (n.headlight !== o.headlight || n.tail !== o.tail || n.brake !== o.brake || n.battery !== o.battery || (n.speedKmh ?? 0) > 0.3 !== (o.speedKmh ?? 0) > 0.3) kick();
    });
  }, [live, kick]);

  const resetCamera = useCallback(() => {
    vel.current = { yaw: 0, pitch: 0 };
    const from = { ...cam.current };
    // go the short way round
    const twoPi = Math.PI * 2;
    let yaw = DEFAULT_CAM.yaw;
    const diff = ((((yaw - from.yaw) % twoPi) + twoPi * 1.5) % twoPi) - Math.PI;
    yaw = from.yaw + diff;
    if (reduceMotion) {
      cam.current = { ...DEFAULT_CAM };
      ease.current = null;
    } else ease.current = { from, to: { ...DEFAULT_CAM, yaw }, start: Date.now(), dur: 650 };
    kick();
  }, [kick, reduceMotion]);

  useImperativeHandle(ref, () => ({ resetCamera }), [resetCamera]);

  // gestures: one finger rotates, two fingers pinch-zoom, double tap resets
  const gesture = useRef({ lastX: 0, lastY: 0, pinch0: 0, dist0: 0, lastTap: 0, moved: 0, lastMoveT: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponder: () => interactive,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const g = gesture.current;
          const t = e.nativeEvent.touches;
          dragging.current = true;
          ease.current = null;
          vel.current = { yaw: 0, pitch: 0 };
          g.lastX = e.nativeEvent.pageX;
          g.lastY = e.nativeEvent.pageY;
          g.moved = 0;
          g.lastMoveT = Date.now();
          g.pinch0 = t.length >= 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
          g.dist0 = cam.current.dist;
          kick();
        },
        onPanResponderMove: (e) => {
          const g = gesture.current;
          const t = e.nativeEvent.touches;
          const now = Date.now();
          if (t.length >= 2) {
            const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
            if (!g.pinch0) {
              g.pinch0 = d;
              g.dist0 = cam.current.dist;
            }
            cam.current.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, (g.dist0 * g.pinch0) / Math.max(20, d)));
            g.moved += 10;
            g.lastX = (t[0].pageX + t[1].pageX) / 2;
            g.lastY = (t[0].pageY + t[1].pageY) / 2;
            return;
          }
          if (g.pinch0) {
            // one finger lifted after a pinch: continue rotating from here
            g.pinch0 = 0;
            g.lastX = e.nativeEvent.pageX;
            g.lastY = e.nativeEvent.pageY;
            return;
          }
          const dx = e.nativeEvent.pageX - g.lastX;
          const dy = e.nativeEvent.pageY - g.lastY;
          g.lastX = e.nativeEvent.pageX;
          g.lastY = e.nativeEvent.pageY;
          g.moved += Math.abs(dx) + Math.abs(dy);
          const k = 0.0085;
          cam.current.yaw -= dx * k;
          cam.current.pitch = clampPitch(cam.current.pitch + dy * k);
          const dtm = Math.max(8, now - g.lastMoveT) / 1000;
          g.lastMoveT = now;
          // smoothed angular velocity for inertia
          vel.current.yaw = vel.current.yaw * 0.6 + ((-dx * k) / dtm) * 0.4;
          vel.current.pitch = vel.current.pitch * 0.6 + ((dy * k) / dtm) * 0.4;
        },
        onPanResponderRelease: () => {
          const g = gesture.current;
          dragging.current = false;
          const now = Date.now();
          if (now - g.lastMoveT > 80) vel.current = { yaw: 0, pitch: 0 };
          if (reduceMotion) vel.current = { yaw: 0, pitch: 0 };
          vel.current.yaw = Math.max(-8, Math.min(8, vel.current.yaw));
          vel.current.pitch = Math.max(-4, Math.min(4, vel.current.pitch));
          if (g.moved < 8) {
            if (now - g.lastTap < 300) {
              g.lastTap = 0;
              resetCamera();
            } else g.lastTap = now;
          }
          kick();
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          kick();
        },
      }),
    [interactive, kick, resetCamera, reduceMotion],
  );

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const accent = C.purple;

  return (
    <View>
      <View style={{ height }} onLayout={onLayout} {...(interactive ? responder.panHandlers : {})}>
        {width > 0 && frame && (
          <Svg width={width} height={height}>
            <Defs>
              <RadialGradient id="s3dFloor" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={accent} stopOpacity={0.22} />
                <Stop offset="1" stopColor={accent} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="s3dHead" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor="#FFF6D6" stopOpacity={0.9} />
                <Stop offset="1" stopColor="#FFF6D6" stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="s3dTail" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor="#FF3040" stopOpacity={0.85} />
                <Stop offset="1" stopColor="#FF3040" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={width / 2} cy={height * 0.72} r={Math.min(width, height) * 0.45} fill="url(#s3dFloor)" />
            {frame.paths.map((p, i) => (
              <Path key={i} d={p.d} fill={p.fill} stroke={p.fill} strokeWidth={0.6} strokeLinejoin="round" />
            ))}
            {frame.headGlow && <Circle cx={frame.headGlow.x} cy={frame.headGlow.y} r={frame.headGlow.r} fill="url(#s3dHead)" />}
            {frame.tailGlow && <Circle cx={frame.tailGlow.x} cy={frame.tailGlow.y} r={frame.tailGlow.r} fill="url(#s3dTail)" opacity={frame.tailGlow.strong ? 1 : 0.6} />}
          </Svg>
        )}
        {interactive && (showReset ?? true) && (
          <Pressable onPress={resetCamera} hitSlop={8} style={styles.reset} accessibilityLabel="Reset camera">
            <Ionicons name="refresh" size={16} color={C.text} />
          </Pressable>
        )}
      </View>
      <Text style={styles.label}>Generic electric scooter visualization — not an exact 3D model of your {title}</Text>
    </View>
  );
}

/** Dashboard/profile card: compact viewer, the generic label and a button to the full-screen viewer. */
/** `live` = sync lights/wheels/battery to the connected scooter (off for other saved scooters). */
export function Scooter3DCard({ live = true }: { live?: boolean }) {
  const show = useSettings((s) => s.show3d);
  useThemeVersion();
  if (!show) return null;
  return (
    <GlassCard>
      <SectionHeader
        title="3D scooter"
        icon="cube-outline"
        right={
          <Pressable onPress={() => router.push('/scooter3d')} hitSlop={10} style={styles.expand} accessibilityLabel="Open full-screen 3D viewer">
            <Ionicons name="expand-outline" size={16} color={C.purpleLight} />
            <Text style={{ color: C.purpleLight, fontWeight: '700', fontSize: 12.5 }}>Expand</Text>
          </Pressable>
        }
      />
      <Scooter3D height={200} interactive live={live} showReset={false} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  label: { color: C.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: S.sm, textAlign: 'center' },
  reset: { position: 'absolute', right: 6, top: 6, width: 32, height: 32, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, get borderColor() { return rgba(C.purple, 0.3); } },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 8 },
});
