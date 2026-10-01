import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';

/**
 * Modelos procedurales low-poly de la vegetación y las rocas.
 * Cada modelo es una única geometría con colores de vértice → una draw call por chunk y tipo.
 */

const srgb = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

function paint(geometry: THREE.BufferGeometry, color: THREE.Color, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const rng = mulberry32(seed);
  // Variación por cara (cada 3 vértices) para el aspecto facetado.
  for (let i = 0; i < count; i += 3) {
    const k = 1 + (rng() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < count; j++) {
      colors[(i + j) * 3] = color.r * k;
      colors[(i + j) * 3 + 1] = color.g * k;
      colors[(i + j) * 3 + 2] = color.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Cilindro entre dos puntos. */
function branch(from: THREE.Vector3, to: THREE.Vector3, rFrom: number, rTo: number, radial: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(rTo, rFrom, len, radial, 1, true);
  geo.translate(0, len / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geo.translate(from.x, from.y, from.z);
  return geo;
}

function blob(center: THREE.Vector3, scale: THREE.Vector3, detail: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  geo.scale(scale.x, scale.y, scale.z);
  geo.translate(center.x, center.y, center.z);
  return geo;
}

const BARK = srgb(0x6e5640);
const ACACIA_LEAF = srgb(0x86984a);
const RIPARIAN_LEAF = srgb(0x4f7632);
const BUSH_LEAF = srgb(0x959a52);
const ROCK = srgb(0x8a7d70);
const MUD_WALL = srgb(0x9a6e48);
const THATCH = srgb(0xb89a5a);

/** Acacia paraguas (Vachellia tortilis): tronco inclinado, ramas abiertas, copa plana. */
export function createAcacia(lowDetail: boolean): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  if (lowDetail) {
    return mergeGeometries([
      paint(branch(V(0, -0.3, 0), V(0.2, 4.6, 0), 0.32, 0.18, 4), BARK),
      paint(blob(V(0.3, 5.6, 0), V(4.4, 0.75, 4.0), 0), ACACIA_LEAF, 0.2, 3),
    ]);
  }
  const trunkTop = V(0.25, 3.3, 0.05);
  const parts: THREE.BufferGeometry[] = [paint(branch(V(0, -0.3, 0), trunkTop, 0.34, 0.22, 7), BARK, 0.15, 1)];
  const tips = [V(2.6, 5.3, 0.9), V(-1.9, 5.5, 1.4), V(0.6, 5.7, -2.4), V(-0.9, 5.2, -1.2)];
  tips.forEach((tip, i) => {
    parts.push(paint(branch(trunkTop, tip, 0.18, 0.08, 5), BARK, 0.15, 10 + i));
  });
  const canopy: [THREE.Vector3, THREE.Vector3][] = [
    [V(2.2, 5.85, 0.7), V(2.6, 0.55, 2.3)],
    [V(-1.6, 6.0, 1.2), V(2.5, 0.6, 2.4)],
    [V(0.5, 6.2, -2.0), V(2.6, 0.55, 2.2)],
    [V(0.1, 6.4, 0.1), V(2.8, 0.7, 2.7)],
    [V(-1.2, 5.75, -1.3), V(1.8, 0.45, 1.7)],
  ];
  canopy.forEach(([c, s], i) => parts.push(paint(blob(c, s, 1), ACACIA_LEAF, 0.28, 20 + i)));
  return mergeGeometries(parts);
}

/** Árbol ribereño (higuera/ébano): tronco alto y copa redondeada, verde oscuro. */
export function createRiparianTree(lowDetail: boolean): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  if (lowDetail) {
    return mergeGeometries([
      paint(branch(V(0, -0.3, 0), V(0, 5, 0), 0.45, 0.28, 4), BARK),
      paint(blob(V(0, 7, 0), V(3.6, 3.0, 3.6), 0), RIPARIAN_LEAF, 0.2, 5),
    ]);
  }
  const parts: THREE.BufferGeometry[] = [paint(branch(V(0, -0.3, 0), V(0.1, 5.2, 0), 0.5, 0.3, 7), BARK, 0.15, 2)];
  const canopy: [THREE.Vector3, THREE.Vector3][] = [
    [V(0, 7.4, 0), V(3.2, 2.6, 3.2)],
    [V(1.9, 6.3, 0.8), V(2.2, 1.9, 2.1)],
    [V(-1.7, 6.5, -0.9), V(2.3, 2.0, 2.2)],
    [V(0.4, 8.6, -0.6), V(2.0, 1.7, 2.0)],
  ];
  canopy.forEach(([c, s], i) => parts.push(paint(blob(c, s, 1), RIPARIAN_LEAF, 0.3, 30 + i)));
  return mergeGeometries(parts);
}

/** Arbusto espinoso bajo (Commiphora / Grewia). */
export function createBush(): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return mergeGeometries([
    paint(blob(V(0, 0.55, 0), V(1.0, 0.75, 0.95), 1), BUSH_LEAF, 0.3, 41),
    paint(blob(V(0.7, 0.4, 0.3), V(0.7, 0.55, 0.65), 1), BUSH_LEAF, 0.3, 42),
    paint(blob(V(-0.5, 0.45, -0.4), V(0.75, 0.6, 0.7), 1), BUSH_LEAF, 0.3, 43),
  ]);
}

/** Canto rodado de granito con vértices desplazados. */
export function createBoulder(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const rng = mulberry32(77);
  const v = new THREE.Vector3();
  // Desplazamiento coherente por posición para no abrir grietas entre caras.
  const offsets = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = offsets.get(key);
    if (k === undefined) {
      k = 0.78 + rng() * 0.38;
      offsets.set(key, k);
    }
    v.multiplyScalar(k);
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return paint(geo, ROCK, 0.22, 78);
}

/** Choza de adobe con techo de paja (placeholder de aldea, Fase 5). */
export function createHut(): THREE.BufferGeometry {
  const walls = new THREE.CylinderGeometry(2.3, 2.4, 2.1, 12, 1, true).translate(0, 1.05, 0);
  const roof = new THREE.ConeGeometry(3.0, 2.2, 12, 1, true).translate(0, 3.15, 0);
  return mergeGeometries([paint(walls, MUD_WALL, 0.12, 51), paint(roof, THATCH, 0.18, 52)]);
}
