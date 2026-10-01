import * as THREE from 'three';
import lionData from '../data/lion.json';
import { clock } from '../core/clock';
import { mulberry32 } from '../core/math';
import { createWildLion, FEMALE_NAMES, MALE_NAMES, wildLions } from '../entities/npc/wildLions';
import { randomTraits } from '../systems/genetics';
import type { WorldData } from './WorldData';

const T = lionData.territory;

export type TerritoryOwner = 'natal' | 'rival' | 'player';

export interface Territory {
  id: number;
  name: string;
  center: THREE.Vector3;
  radius: number;
  owner: TerritoryOwner;
  color: string;
}

export interface ScentMark {
  x: number;
  z: number;
  /** Día de juego (con fracción) en que se dejó. */
  day: number;
  /** Territorio que marca (o -1 para el jugador nómada). */
  territoryId: number;
  byPlayer: boolean;
}

export const territories: Territory[] = [];
export const scentMarks: ScentMark[] = [];

const COLORS = ['#c9953c', '#9b3f2c', '#4f6f8f', '#6d7f3a'];

function directionName(x: number, z: number): string {
  const ang = Math.atan2(-z, x);
  const dirs = ['del este', 'del noreste', 'del norte', 'del noroeste', 'del oeste', 'del suroeste', 'del sur', 'del sureste'];
  return dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
}

/**
 * Territorios de la sabana: el de la manada natal y dos manadas rivales con su macho
 * residente y sus leonas, más grupos de machos nómadas que vagan entre territorios.
 */
export function initTerritories(world: WorldData, natalX: number, natalZ: number, seed: number): void {
  const rng = mulberry32(seed);
  territories.length = 0;
  scentMarks.length = 0;
  wildLions.length = 0;

  territories.push({
    id: 0,
    name: 'Manada natal',
    center: new THREE.Vector3(natalX, world.heightAt(natalX, natalZ), natalZ),
    radius: T.radiusM,
    owner: 'natal',
    color: COLORS[0],
  });

  // Candidatos: kopjes y pozas lejos de la madriguera natal y entre sí.
  const sites = [
    ...world.features.kopjes.map((k) => ({ x: k.x, z: k.z, kind: 'las Rocas' })),
    ...world.features.waterholes.map((w) => ({ x: w.x + w.radius * 3, z: w.z, kind: 'la Poza' })),
  ].filter((s) => Math.hypot(s.x - natalX, s.z - natalZ) > 1150);
  sites.sort(() => rng() - 0.5);
  const chosen: typeof sites = [];
  for (const s of sites) {
    if (chosen.length >= 2) break;
    if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 1100)) chosen.push(s);
  }

  const usedNames = new Set<string>();
  const pick = (list: string[]) => {
    let n = list[Math.floor(rng() * list.length)];
    for (let i = 0; i < 20 && usedNames.has(n); i++) n = list[Math.floor(rng() * list.length)];
    usedNames.add(n);
    return n;
  };

  chosen.forEach((site, i) => {
    const id = i + 1;
    territories.push({
      id,
      name: `Manada de ${site.kind} ${directionName(site.x, site.z)}`,
      center: new THREE.Vector3(site.x, world.heightAt(site.x, site.z), site.z),
      radius: T.radiusM,
      owner: 'rival',
      color: COLORS[id],
    });
    // Coalición residente de 1–2 machos y 3 leonas.
    const males = 1 + (rng() < 0.55 ? 1 : 0);
    for (let m = 0; m < males; m++) {
      const x = site.x + (rng() - 0.5) * 40;
      const z = site.z + (rng() - 0.5) * 40;
      const lion = createWildLion('resident', pick(MALE_NAMES), 'male', 6 + rng() * 3, randomTraits(rng), x, world.heightAt(x, z), z);
      lion.territoryId = id;
      lion.traits.maneDarkness = Math.max(lion.traits.maneDarkness, 0.5);
      lion.relation = -0.5;
      wildLions.push(lion);
    }
    for (let f = 0; f < 3; f++) {
      const x = site.x + (rng() - 0.5) * 30;
      const z = site.z + (rng() - 0.5) * 30;
      const lion = createWildLion('female', pick(FEMALE_NAMES), 'female', 4 + rng() * 5, randomTraits(rng), x, world.heightAt(x, z), z);
      lion.territoryId = id;
      wildLions.push(lion);
    }
  });

  // Machos nómadas: solitarios o parejas de hermanos.
  for (let g = 0; g < 3; g++) {
    const x = (rng() * 2 - 1) * 1500;
    const z = (rng() * 2 - 1) * 1500;
    const count = rng() < 0.6 ? 1 : 2;
    for (let n = 0; n < count; n++) {
      const lx = x + n * 4;
      const lion = createWildLion('nomad', pick(MALE_NAMES), 'male', 2.8 + rng() * 2.5, randomTraits(rng), lx, world.heightAt(lx, z), z);
      lion.groupId = 100 + g;
      lion.relation = rng() * 0.6 - 0.2;
      lion.state = 'wander';
      wildLions.push(lion);
    }
  }
}

/** Territorio que contiene un punto (el más cercano si se solapan). */
export function territoryAt(x: number, z: number): Territory | null {
  let best: Territory | null = null;
  let bestD = Infinity;
  for (const t of territories) {
    const d = Math.hypot(t.center.x - x, t.center.z - z);
    if (d < t.radius && d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function addScentMark(x: number, z: number, territoryId: number, byPlayer: boolean): void {
  scentMarks.push({ x, z, day: clock.totalDays, territoryId, byPlayer });
  if (scentMarks.length > 200) scentMarks.shift();
}

/** Las marcas se desvanecen con los días. Devuelve la intensidad [0, 1]. */
export function markStrength(m: ScentMark): number {
  return Math.max(0, 1 - (clock.totalDays - m.day) / T.markLifeDays);
}

export function pruneMarks(): void {
  for (let i = scentMarks.length - 1; i >= 0; i--) if (markStrength(scentMarks[i]) <= 0) scentMarks.splice(i, 1);
}

export const residentsOf = (id: number) => wildLions.filter((l) => l.alive && l.role === 'resident' && l.territoryId === id);
export const femalesOf = (id: number) => wildLions.filter((l) => l.alive && l.role === 'female' && l.territoryId === id);
export const playerTerritory = (): Territory | null => territories.find((t) => t.owner === 'player') ?? null;
