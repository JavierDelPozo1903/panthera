import * as THREE from 'three';
import preyData from '../data/prey.json';
import { events } from '../core/events';
import { lerp, moveTowardsAngle, mulberry32 } from '../core/math';
import { spawnCarcass } from '../entities/carcass/carcassState';
import type { PreySpecies } from '../entities/prey/preyRig';
import { herds, type Herd, type PreyAnimal } from '../entities/prey/preyState';
import { player } from '../entities/player/playerState';
import { atmosphere } from '../world/atmosphereState';
import { Biome } from '../world/biomes';
import type { WorldData } from '../world/WorldData';
import { downwindOf } from '../systems/wind';
import { predatorViews, type PredatorView } from './predators';
import { distXZ, moveForward, steerTowards } from './steering';

const SPECIES = preyData.species;
const H = preyData.herds;

/** Proporción de cada especie al poblar el mapa. */
const SPECIES_WEIGHTS: [PreySpecies, number][] = [
  ['wildebeest', 4],
  ['zebra', 4],
  ['impala', 5],
  ['warthog', 3],
];

let herdId = 1;
let animalId = 1;

function pickSpecies(rng: () => number): PreySpecies {
  const total = SPECIES_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [s, w] of SPECIES_WEIGHTS) {
    r -= w;
    if (r <= 0) return s;
  }
  return 'impala';
}

/** Puebla el mapa de manadas según el bioma preferido de cada especie. */
export function initHerds(world: WorldData, seed: number): void {
  const rng = mulberry32(seed);
  herds.length = 0;
  for (let i = 0; i < H.count; i++) {
    const species = pickSpecies(rng);
    const wantWood = SPECIES[species].biome === 'woodland';
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = (rng() * 2 - 1) * 1750;
      z = (rng() * 2 - 1) * 1750;
      const b = world.biomeAt(x, z);
      const ok = world.waterLevelAt(x, z) === null && (wantWood ? b === Biome.Woodland : b === Biome.Grassland);
      if (ok) break;
    }
    const [min, max] = SPECIES[species].herdSize;
    herds.push({
      id: herdId++,
      species,
      size: Math.round(min + rng() * (max - min)),
      center: new THREE.Vector3(x, world.heightAt(x, z), z),
      target: new THREE.Vector3(x, 0, z),
      mode: 'graze',
      modeTimer: 0,
      threat: new THREE.Vector3(),
      members: [],
      spawned: false,
      lastSeen: -1e9,
    });
  }
}

function spawnMembers(herd: Herd, world: WorldData, rng: () => number): void {
  const spread = 3 + Math.sqrt(herd.size) * 3;
  const [rMin, rMax] = SPECIES[herd.species].reaction;
  for (let i = 0; i < herd.size; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * spread;
    const x = herd.center.x + Math.cos(a) * r;
    const z = herd.center.z + Math.sin(a) * r;
    herd.members.push({
      id: `prey-${animalId}`,
      species: herd.species,
      seed: animalId++,
      herd,
      position: new THREE.Vector3(x, world.heightAt(x, z), z),
      heading: rng() * Math.PI * 2,
      speed: 0,
      state: 'graze',
      timer: rng() * 6,
      awareness: 0,
      reaction: lerp(rMin, rMax, rng()),
      offset: new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r),
      vigilant: rng() < 0.2,
      alive: true,
      clip: 'drink',
    });
  }
  herd.spawned = true;
}

function despawnMembers(herd: Herd): void {
  const alive = herd.members.filter((m) => m.alive);
  if (alive.length) {
    herd.center.set(0, 0, 0);
    for (const m of alive) herd.center.add(m.position);
    herd.center.divideScalar(alive.length);
  }
  herd.size = alive.length;
  herd.members = [];
  herd.spawned = false;
}

/** Cuánto ve una presa a un depredador este frame (0 = nada). */
function perceive(prey: PreyAnimal, p: PredatorView, range: number): number {
  const dx = p.x - prey.position.x;
  const dz = p.z - prey.position.z;
  const d = Math.hypot(dx, dz);
  if (d > range * 1.3) return 0;
  // Campo visual casi panorámico con un ángulo muerto detrás.
  const facing = (Math.sin(prey.heading) * dx + Math.cos(prey.heading) * dz) / Math.max(d, 0.01);
  const cone = facing < -0.7 ? 0.25 : 1;
  const light = lerp(1, 0.5 + 0.3 * atmosphere.moonIllumination * atmosphere.moonUp, atmosphere.night);
  const head = prey.state === 'graze' && !prey.vigilant ? 0.4 : 1;
  // Caída suave con la distancia: un león al descubierto se distingue bien a 50–80 m.
  const falloff = Math.max(0, 1 - (d / range) ** 2);
  // Respuesta no lineal: un león oculto e inmóvil apenas se percibe; uno al descubierto, enseguida.
  const sight = falloff * Math.pow(p.visibility, 1.5) * cone * light * head;
  // Olfato: el olor viaja con el viento hacia la presa.
  const scent = d < 70 && downwindOf(p.x, p.z, prey.position.x, prey.position.z) > 0.6 ? (1 - d / 70) * 0.6 : 0;
  return sight * 3 + scent;
}

const tmp = new THREE.Vector3();

/**
 * Manadas de presas. Lejos del jugador solo se simula el centro de la manada (simulación
 * "fuera de pantalla"); cerca se instancian los individuos con vigilancia por turnos,
 * detección por vista y olfato, alerta contagiosa y estampida con comportamiento de bandada.
 */
export function updatePrey(world: WorldData, dt: number, rng: () => number, elapsed: number): void {
  const preds = predatorViews(world);

  for (const herd of herds) {
    const dPlayer = distXZ(herd.center, player.position);
    if (!herd.spawned && dPlayer < H.spawnRadius && herd.size > 0) spawnMembers(herd, world, rng);
    else if (herd.spawned && dPlayer > H.despawnRadius && herd.mode !== 'flee') despawnMembers(herd);

    const spec = SPECIES[herd.species];
    herd.modeTimer -= dt;

    if (!herd.spawned) {
      // Deriva lenta mientras pasta.
      if (distXZ(herd.center, herd.target) < 5 || herd.modeTimer <= 0) {
        const a = rng() * Math.PI * 2;
        herd.target.set(herd.center.x + Math.cos(a) * 220, 0, herd.center.z + Math.sin(a) * 220);
        herd.modeTimer = 120;
      }
      const mover = { position: herd.center, heading: Math.atan2(herd.target.x - herd.center.x, herd.target.z - herd.center.z), speed: 0.35 };
      moveForward(mover, world, dt, 0.3);
      continue;
    }

    const alive = herd.members.filter((m) => m.alive);
    if (alive.length === 0) {
      herd.size = 0;
      continue;
    }
    // Centro real = centroide de los vivos.
    herd.center.set(0, 0, 0);
    for (const m of alive) herd.center.add(m.position);
    herd.center.divideScalar(alive.length);

    // Vista por parte del jugador (para el mapa y los objetivos).
    if (dPlayer < 140) herd.lastSeen = elapsed;

    // --- Percepción individual y contagio de la alarma ---
    let herdAlarm = 0;
    let threatPred: PredatorView | null = null;
    for (const m of alive) {
      if (m.state === 'struggle') continue;
      m.timer -= dt;
      // Turnos de vigilancia: unos pocos levantan la cabeza cada cierto tiempo.
      if (m.timer <= 0) {
        m.vigilant = rng() < 0.22;
        m.timer = 2 + rng() * 5;
      }
      let best = 0;
      for (const p of preds) {
        const s = perceive(m, p, spec.sightRange);
        // Un depredador lanzado a la carrera cerca es inconfundible.
        const charging = p.speed > 6 && Math.hypot(p.x - m.position.x, p.z - m.position.z) < 35;
        const stimulus = charging ? 5 : s;
        if (stimulus > best) {
          best = stimulus;
          if (stimulus > 0.2) threatPred = p;
        }
      }
      // Una vez inquieta, la presa tarda en tranquilizarse.
      const decay = m.awareness > 0.3 ? 0.08 : 0.12;
      m.awareness = Math.min(1.2, Math.max(0, m.awareness + (best - decay) * dt));
      herdAlarm = Math.max(herdAlarm, m.awareness);
    }

    if (herd.mode !== 'flee' && herdAlarm >= 1 && threatPred) {
      herd.mode = 'flee';
      herd.modeTimer = 8;
      herd.threat.set(threatPred.x, 0, threatPred.z);
      events.emit('subtitle', { text: `[Bufidos de alarma: los ${spec.label.toLowerCase()}s huyen]`, seconds: 2.5 });
    } else if (herd.mode === 'graze' && herdAlarm > 0.45) {
      herd.mode = 'alert';
      herd.modeTimer = 6;
      if (threatPred) herd.threat.set(threatPred.x, 0, threatPred.z);
      // Alarma compartida: toda la manada levanta la cabeza y se aleja despacio.
      for (const m of alive) {
        m.vigilant = true;
        m.awareness = Math.max(m.awareness, herdAlarm * 0.6);
      }
      tmp.set(herd.center.x - herd.threat.x, 0, herd.center.z - herd.threat.z).normalize();
      herd.target.set(herd.center.x + tmp.x * 60, 0, herd.center.z + tmp.z * 60);
    } else if (herd.mode === 'alert' && herd.modeTimer <= 0 && herdAlarm < 0.4) {
      herd.mode = 'graze';
    }
    if (herd.mode === 'flee') {
      if (threatPred && distXZ(herd.center, { x: threatPred.x, z: threatPred.z }) < 70) {
        herd.threat.set(threatPred.x, 0, threatPred.z);
        herd.modeTimer = Math.max(herd.modeTimer, 5);
      }
      if (herd.modeTimer <= 0) {
        herd.mode = 'graze';
        for (const m of alive) m.awareness = 0.3;
        herd.target.copy(herd.center);
      }
    }

    // --- Movimiento ---
    if (herd.mode === 'graze' && (distXZ(herd.center, herd.target) < 4 || herd.modeTimer <= 0)) {
      const a = rng() * Math.PI * 2;
      herd.target.set(herd.center.x + Math.cos(a) * 40, 0, herd.center.z + Math.sin(a) * 40);
      herd.modeTimer = 40 + rng() * 40;
    }
    const drift = tmp.set(herd.target.x - herd.center.x, 0, herd.target.z - herd.center.z);
    if (drift.lengthSq() > 1) drift.normalize().multiplyScalar(Math.min(6, drift.length()));

    for (const m of alive) {
      if (m.state === 'struggle') {
        m.speed = 0;
        m.clip = 'run';
        continue;
      }
      if (herd.mode === 'flee') {
        if (m.state !== 'flee') {
          m.reaction -= dt;
          m.clip = 'idle';
          m.heading = Math.atan2(m.position.x - herd.threat.x, m.position.z - herd.threat.z);
          if (m.reaction <= 0) m.state = 'flee';
          continue;
        }
        // Huida: lejos de la amenaza, separándose de los vecinos y con quiebros.
        let ax = m.position.x - herd.threat.x;
        let az = m.position.z - herd.threat.z;
        const al = Math.hypot(ax, az) || 1;
        ax /= al;
        az /= al;
        for (const o of alive) {
          if (o === m) continue;
          const ox = m.position.x - o.position.x;
          const oz = m.position.z - o.position.z;
          const od = Math.hypot(ox, oz);
          if (od < 2.5 && od > 0.01) {
            ax += (ox / od) * (2.5 - od) * 0.6;
            az += (oz / od) * (2.5 - od) * 0.6;
          }
        }
        const zig = Math.sin(elapsed * 2.3 + m.seed) * 0.35;
        const desired = Math.atan2(ax, az) + zig;
        m.heading = moveTowardsAngle(m.heading, desired, 3.5 * dt);
        // Aceleración lineal realista: la presa tarda unos segundos en alcanzar su punta.
        const top = spec.topSpeed * (0.92 + (m.seed % 7) * 0.012);
        m.speed = Math.min(top, m.speed + spec.accel * dt);
        moveForward(m, world, dt, 0.4);
        m.clip = 'run';
      } else {
        m.state = herd.mode === 'alert' ? 'alert' : 'graze';
        m.reaction = lerp(spec.reaction[0], spec.reaction[1], (m.seed % 10) / 10);
        const tx = herd.center.x + drift.x + m.offset.x;
        const tz = herd.center.z + drift.z + m.offset.y;
        const far = Math.hypot(tx - m.position.x, tz - m.position.z);
        if (m.state === 'alert') {
          // Cabeza alta: miran a la amenaza y se alejan al paso.
          const away = Math.atan2(m.position.x - herd.threat.x, m.position.z - herd.threat.z);
          const walking = (m.seed + Math.floor(elapsed)) % 3 !== 0;
          if (walking) {
            m.heading = moveTowardsAngle(m.heading, away, 2 * dt);
            m.speed = spec.walk * 0.8;
            moveForward(m, world, dt, 0.3);
            m.clip = 'walk';
          } else {
            m.speed = 0;
            m.heading = moveTowardsAngle(m.heading, away + Math.PI, 3 * dt);
            m.clip = 'idle';
            m.position.y = world.heightAt(m.position.x, m.position.z);
          }
        } else {
          steerTowards(m, world, tx, tz, far > 3 ? spec.walk : 0, dt, { stopDistance: 1.5, turnRate: 1.5 });
          m.clip = m.speed > 0.15 ? 'walk' : m.vigilant ? 'idle' : 'drink';
        }
      }
    }
  }
}

/** Una presa muere: queda su cuerpo como carroña con la carne aprovechable de su especie. */
export function killPrey(prey: PreyAnimal): void {
  prey.alive = false;
  prey.state = 'dead';
  const spec = SPECIES[prey.species];
  spawnCarcass(prey.position.x, prey.position.y, prey.position.z, prey.heading + Math.PI / 2, spec.weightKg * spec.meatFraction, prey.species);
  prey.herd.members = prey.herd.members.filter((m) => m !== prey);
  prey.herd.size = Math.max(0, prey.herd.size - 1);
  // El resto huye.
  prey.herd.mode = 'flee';
  prey.herd.modeTimer = 8;
  prey.herd.threat.copy(prey.position);
}

/** Inicio de la lucha: la presa queda sujeta. */
export function grabPrey(prey: PreyAnimal): void {
  prey.state = 'struggle';
  prey.speed = 0;
}

/** La presa se zafa y sale disparada. */
export function releasePrey(prey: PreyAnimal, fromX: number, fromZ: number): void {
  prey.state = 'flee';
  prey.awareness = 1.2;
  prey.herd.mode = 'flee';
  prey.herd.modeTimer = 8;
  prey.herd.threat.set(fromX, 0, fromZ);
  prey.speed = SPECIES[prey.species].topSpeed * 0.5;
}

export const preySpec = (s: PreySpecies) => SPECIES[s];
