import { bosses } from '../ai/bossEngine';
import { hyenas, pride } from '../entities/npc/npcState';
import { wildLions } from '../entities/npc/wildLions';
import { player } from '../entities/player/playerState';
import { herds } from '../entities/prey/preyState';
import { combat } from './combat';
import { wind } from './wind';

/**
 * Modo sensorial: agachado y quieto un instante, el león deja de ver como un humano. El
 * mundo se apaga y aparecen los rastros de olor (que deriva con el viento) y las ondas del
 * ruido de los animales que corren.
 */
export type ScentKind = 'prey' | 'hyena' | 'lion' | 'boss';

export interface ScentPuff {
  x: number;
  z: number;
  age: number;
  life: number;
  kind: ScentKind;
}

export interface SoundPing {
  x: number;
  z: number;
  age: number;
  life: number;
  kind: ScentKind;
  strength: number;
}

export const SENSE_DELAY = 0.6;
export const SCENT_RANGE = 170;
export const MAX_PUFFS = 900;
export const MAX_PINGS = 48;

export const senses = {
  /** Intensidad del modo [0, 1]. */
  level: 0,
  crouchTime: 0,
  sampleTimer: 0,
};

export const puffs: ScentPuff[] = [];
export const pings: SoundPing[] = [];
const lastPing = new Map<string, number>();
let time = 0;

export function resetSenses(): void {
  senses.level = 0;
  senses.crouchTime = 0;
  puffs.length = 0;
  pings.length = 0;
  lastPing.clear();
}

/** Puede activarse el modo ahora mismo. */
export function sensesAllowed(): boolean {
  return player.alive && player.crouching && !combat.active && !player.swimming;
}

interface Source {
  id: string;
  x: number;
  z: number;
  speed: number;
  kind: ScentKind;
}

function sources(): Source[] {
  const list: Source[] = [];
  const px = player.position.x;
  const pz = player.position.z;
  const near = (x: number, z: number) => Math.hypot(x - px, z - pz) < SCENT_RANGE;
  for (const h of herds) {
    if (!h.spawned) continue;
    for (const m of h.members) if (m.alive && near(m.position.x, m.position.z)) list.push({ id: m.id, x: m.position.x, z: m.position.z, speed: m.speed, kind: 'prey' });
  }
  for (const h of hyenas) if (h.alive && near(h.position.x, h.position.z)) list.push({ id: h.id, x: h.position.x, z: h.position.z, speed: h.speed, kind: 'hyena' });
  for (const l of wildLions) if (l.alive && near(l.position.x, l.position.z)) list.push({ id: l.id, x: l.position.x, z: l.position.z, speed: l.speed, kind: 'lion' });
  for (const l of pride) if (l.alive && near(l.position.x, l.position.z)) list.push({ id: l.id, x: l.position.x, z: l.position.z, speed: l.speed, kind: 'lion' });
  for (const b of bosses) {
    if (!b.initialized || b.state === 'defeated' || b.vanish > 0) continue;
    const a = b.agent;
    if (near(a.position.x, a.position.z)) list.push({ id: a.id, x: a.position.x, z: a.position.z, speed: a.speed, kind: 'boss' });
  }
  return list;
}

export function updateSenses(dt: number): void {
  time += dt;
  senses.crouchTime = sensesAllowed() ? senses.crouchTime + dt : 0;
  const target = senses.crouchTime > SENSE_DELAY ? 1 : 0;
  senses.level += (target - senses.level) * Math.min(1, dt * (target ? 2.2 : 4));
  if (senses.level < 0.002) senses.level = 0;

  // El olor deriva a sotavento y se desvanece.
  const drift = 0.7 * wind.strength;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.age += dt;
    p.x += wind.dir.x * drift * dt;
    p.z += wind.dir.y * drift * dt;
    if (p.age > p.life) puffs.splice(i, 1);
  }
  for (let i = pings.length - 1; i >= 0; i--) {
    pings[i].age += dt;
    if (pings[i].age > pings[i].life) pings.splice(i, 1);
  }
  if (senses.level <= 0) return;

  senses.sampleTimer -= dt;
  const list = sources();
  if (senses.sampleTimer <= 0) {
    senses.sampleTimer = 0.4;
    for (const s of list) {
      if (puffs.length >= MAX_PUFFS) puffs.shift();
      const j = (Math.sin(time * 91.7 + s.x) * 0.5) * 0.8;
      puffs.push({ x: s.x + j, z: s.z - j, age: 0, life: s.kind === 'boss' ? 14 : 10, kind: s.kind });
    }
  }
  // Ondas de sonido de los que corren.
  for (const s of list) {
    if (s.speed < 3.2) continue;
    const last = lastPing.get(s.id) ?? -Infinity;
    const every = s.speed > 8 ? 0.6 : 1;
    if (time - last < every) continue;
    lastPing.set(s.id, time);
    if (pings.length >= MAX_PINGS) pings.shift();
    pings.push({ x: s.x, z: s.z, age: 0, life: 1.6, kind: s.kind, strength: Math.min(1, s.speed / 10) });
  }
}
