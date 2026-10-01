import * as THREE from 'three';
import { events } from '../core/events';
import { player } from '../entities/player/playerState';
import { addDen, claimDen, dens } from '../systems/dens';
import { recordMilestone } from '../systems/journal';
import { progression } from '../systems/progression';
import { visited } from '../systems/quests';
import { Biome } from './biomes';
import type { WorldData } from './WorldData';

/**
 * Regiones del continente. El mundo de 4 × 4 km se reparte en zonas con carácter propio
 * (luz, niebla, jefe y guarida). Al principio solo está abierta la sabana; cada región se
 * abre al vencer al jefe de la anterior y, mientras tanto, una niebla espesa cierra el paso.
 */
export type RegionId = 'savanna' | 'delta' | 'kalahari' | 'congo' | 'mountains' | 'crater' | 'coast';

export interface Region {
  id: RegionId;
  name: string;
  /** Jefe que hay que vencer para entrar (null = abierta). */
  requires: string | null;
  requiresText: string;
  center: THREE.Vector3;
  radius: number;
  /** Tinte de la niebla y la luz ambiente dentro de la región. */
  tint: string;
  /** Densidad extra de niebla [0, 1]. */
  haze: number;
  /** Punto del claro del jefe. */
  arena: THREE.Vector3;
  denId: string;
  denName: string;
}

export const regions: Region[] = [];
export const regionState = { current: 'savanna' as RegionId, warnCooldown: 0, initialized: false };

interface Spec {
  id: Exclude<RegionId, 'savanna'>;
  name: string;
  requires: string;
  requiresText: string;
  tint: string;
  haze: number;
  denName: string;
  radius: number;
}

const SPECS: Spec[] = [
  { id: 'delta', name: 'Delta del Okavango', requires: 'matriarch', requiresText: 'Vence a La Matriarca', tint: '#5f7d6e', haze: 0.35, denName: 'Guarida de los Papiros', radius: 420 },
  { id: 'kalahari', name: 'Desierto del Kalahari', requires: 'crocodile', requiresText: 'Vence al Señor del Delta', tint: '#d39a5a', haze: 0.25, denName: 'Guarida de las Dunas', radius: 400 },
  { id: 'congo', name: 'Selva del Congo', requires: 'shadowLion', requiresText: 'Vence a La Sombra del Kalahari', tint: '#3e5a35', haze: 0.55, denName: 'Guarida del Ceibo', radius: 380 },
  { id: 'mountains', name: 'Montes Rwenzori', requires: 'leopard', requiresText: 'Vence a El Fantasma', tint: '#7d8a99', haze: 0.6, denName: 'Guarida de la Niebla', radius: 380 },
  { id: 'crater', name: 'Cráter del Ngorongoro', requires: 'buffalo', requiresText: 'Vence al Guardián de la Niebla', tint: '#8a6aa3', haze: 0.3, denName: 'Guarida del Trono', radius: 340 },
  { id: 'coast', name: 'Costa olvidada', requires: 'kings', requiresText: 'Derrota al Rey de Reyes', tint: '#8fa1a8', haze: 0.65, denName: 'Guarida de la Marea', radius: 300 },
];

interface Candidate {
  x: number;
  z: number;
  height: number;
  wood: number;
  wet: number;
  kopje: number;
}

function sampleCandidate(world: WorldData, x: number, z: number): Candidate {
  let wood = 0;
  let wet = 0;
  let height = 0;
  let n = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const sx = x + i * 90;
      const sz = z + j * 90;
      const b = world.biomeAt(sx, sz);
      if (b === Biome.Woodland || b === Biome.Riparian) wood++;
      if (b === Biome.Swamp || b === Biome.River || b === Biome.Waterhole || world.waterLevelAt(sx, sz) !== null) wet++;
      height += world.heightAt(sx, sz);
      n++;
    }
  }
  let kopje = 0;
  for (const k of world.features.kopjes) if (Math.hypot(k.x - x, k.z - z) < 260) kopje += k.radius;
  return { x, z, height: height / n, wood: wood / n, wet: wet / n, kopje };
}

/** Punto llano cerca de (x, z) para el claro de un jefe. */
export function flatSpotNear(world: WorldData, x: number, z: number, minR: number, maxR: number): THREE.Vector3 {
  let best = new THREE.Vector3(x, world.heightAt(x, z), z);
  let bestSlope = Infinity;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r = minR + ((i * 7) % 5) * ((maxR - minR) / 4);
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (!world.inBounds(px, pz, 120) || world.waterLevelAt(px, pz) !== null) continue;
    let slope = 0;
    for (const [ox, oz] of [[18, 0], [-18, 0], [0, 18], [0, -18]]) slope += Math.abs(world.heightAt(px + ox, pz + oz) - world.heightAt(px, pz));
    if (slope < bestSlope) {
      bestSlope = slope;
      best = new THREE.Vector3(px, world.heightAt(px, pz), pz);
    }
  }
  return best;
}

/** Reparte las regiones por el mapa según el relieve y la vegetación. */
export function initRegions(world: WorldData, denX: number, denZ: number): void {
  regions.length = 0;
  const half = world.half;
  const cands: Candidate[] = [];
  for (let x = -half + 480; x <= half - 480; x += 220) {
    for (let z = -half + 480; z <= half - 480; z += 220) cands.push(sampleCandidate(world, x, z));
  }
  const placed: { x: number; z: number; r: number }[] = [{ x: denX, z: denZ, r: 520 }];
  const free = (x: number, z: number, r: number) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 60);
  const pick = (score: (c: Candidate) => number, r: number): Candidate => {
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      if (!free(c.x, c.z, r)) continue;
      const s = score(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best ?? cands[Math.floor(cands.length / 2)];
  };

  const positions = new Map<RegionId, { x: number; z: number }>();
  // El delta va sobre el pantano del mapa.
  const sw = world.features.swamp;
  positions.set('delta', { x: sw.x, z: sw.z });
  placed.push({ x: sw.x, z: sw.z, r: SPECS[0].radius });
  // La costa, junto al borde oeste del mundo.
  const coastZ = Math.max(-half + 400, Math.min(half - 400, -denZ * 0.5));
  positions.set('coast', { x: -half + 330, z: coastZ });
  placed.push({ x: -half + 330, z: coastZ, r: 300 });
  const order: [RegionId, (c: Candidate) => number][] = [
    ['mountains', (c) => c.height * 2 - c.wet * 40],
    ['congo', (c) => c.wood * 100 + c.wet * 20],
    ['crater', (c) => c.kopje + c.height * 0.5],
    ['kalahari', (c) => -c.wet * 120 - c.wood * 60 + Math.hypot(c.x - denX, c.z - denZ) * 0.02],
  ];
  for (const [id, score] of order) {
    const spec = SPECS.find((s) => s.id === id)!;
    const c = pick(score, spec.radius);
    positions.set(id, { x: c.x, z: c.z });
    placed.push({ x: c.x, z: c.z, r: spec.radius });
  }

  regions.push({
    id: 'savanna',
    name: 'Sabana de Seronera',
    requires: null,
    requiresText: '',
    center: new THREE.Vector3(denX, world.heightAt(denX, denZ), denZ),
    radius: 0,
    tint: '#c9953c',
    haze: 0,
    arena: new THREE.Vector3(),
    denId: 'natal',
    denName: 'Guarida de la Acacia',
  });
  for (const spec of SPECS) {
    const p = positions.get(spec.id)!;
    const center = new THREE.Vector3(p.x, world.heightAt(p.x, p.z), p.z);
    const arena = flatSpotNear(world, p.x, p.z, 60, 160);
    // La guarida, en el lado de la región que mira a la madriguera natal.
    const dx = denX - p.x;
    const dz = denZ - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    const edge = flatSpotNear(world, p.x + (dx / dl) * spec.radius * 0.7, p.z + (dz / dl) * spec.radius * 0.7, 0, 50);
    regions.push({
      id: spec.id,
      name: spec.name,
      requires: spec.requires,
      requiresText: spec.requiresText,
      center,
      radius: spec.radius,
      tint: spec.tint,
      haze: spec.haze,
      arena,
      denId: spec.id,
      denName: spec.denName,
    });
    addDen({ id: spec.id, name: spec.denName, x: edge.x, z: edge.z, claimed: false });
  }
  regionState.current = 'savanna';
  regionState.initialized = true;
}

export const regionById = (id: RegionId): Region | undefined => regions.find((r) => r.id === id);

export const isRegionOpen = (r: Region): boolean => !r.requires || progression.bossesDefeated.includes(r.requires);

/** Región que contiene un punto (la sabana si no está en ninguna otra). */
export function regionAt(x: number, z: number): Region {
  let best: Region | null = null;
  for (const r of regions) {
    if (r.radius <= 0) continue;
    if (Math.hypot(r.center.x - x, r.center.z - z) < r.radius && (!best || r.radius < best.radius)) best = r;
  }
  return best ?? regions[0];
}

/** Cuánto pesa la región en un punto [0, 1] (transición suave en el borde). */
export function regionBlend(r: Region, x: number, z: number): number {
  if (r.radius <= 0) return 0;
  const d = Math.hypot(r.center.x - x, r.center.z - z);
  return Math.max(0, Math.min(1, (r.radius - d) / 80 + 0.0));
}

/**
 * Fronteras: la niebla impide entrar en regiones cerradas. Al entrar por primera vez en una
 * abierta se anuncia y se marca como visitada; las guaridas se reclaman al llegar a ellas.
 */
export function updateRegions(dt: number): void {
  if (!regionState.initialized || !player.alive) return;
  regionState.warnCooldown = Math.max(0, regionState.warnCooldown - dt);
  for (const r of regions) {
    if (r.radius <= 0 || isRegionOpen(r)) continue;
    const dx = player.position.x - r.center.x;
    const dz = player.position.z - r.center.z;
    const d = Math.hypot(dx, dz);
    const wall = r.radius + 4;
    if (d < wall) {
      // Empuja hacia fuera (si está justo en el centro, hacia la sabana).
      const ux = d > 0.5 ? dx / d : 1;
      const uz = d > 0.5 ? dz / d : 0;
      player.position.x = r.center.x + ux * wall;
      player.position.z = r.center.z + uz * wall;
      if (regionState.warnCooldown <= 0) {
        regionState.warnCooldown = 6;
        events.emit('subtitle', { text: `Una niebla espesa te cierra el paso a ${r.name}. ${r.requiresText}.`, seconds: 4 });
      }
    }
  }
  const here = regionAt(player.position.x, player.position.z);
  if (here.id !== regionState.current) {
    regionState.current = here.id;
    if (!visited.has(here.id)) {
      visited.add(here.id);
      if (here.id !== 'savanna') {
        events.emit('banner', { text: here.name, tone: 'info', seconds: 3.5 });
        recordMilestone(`region:${here.id}`, `Llegas a ${here.name}`);
      }
    }
  }
  for (const d of dens) {
    if (d.claimed || Math.hypot(d.x - player.position.x, d.z - player.position.z) > 12) continue;
    const r = regions.find((x) => x.denId === d.id);
    if (r && !isRegionOpen(r)) continue;
    claimDen(d.id);
    recordMilestone(`den:${d.id}`, `Descubres la ${d.name.toLowerCase()}`);
  }
}
