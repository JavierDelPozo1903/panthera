import * as THREE from 'three';
import lionData from '../data/lion.json';
import { events } from '../core/events';
import { mother, prideAunts, type Agent } from '../entities/npc/npcState';
import type { Herd, PreyAnimal } from '../entities/prey/preyState';
import { player } from '../entities/player/playerState';
import { journal, recordMilestone } from '../systems/journal';
import type { WorldData } from '../world/WorldData';
import { grabPrey, killPrey, preySpec, releasePrey } from './preyBrain';
import { clipForSpeed, distXZ, steerTowards } from './steering';

const L = lionData.locomotion;
const CHARGE_SPEED = 13.6;
const CHARGE_SECONDS = 11;
/** Distancia de arranque de la carrera (20–30 m según la biología). */
const CHARGE_DISTANCE = lionData.hunting.chargeDistanceM.max - 4;

type HuntPhase = 'approach' | 'stalk' | 'charge' | 'struggle' | 'done';

interface Hunter {
  agent: Agent;
  /** 0 = centro; ±1 = alas. */
  side: number;
}

/**
 * Caza cooperativa de las leonas. Fases:
 *  - approach: se acercan en grupo a la manada de presas hasta unos 130 m.
 *  - stalk: avanzan agachadas; las alas abren en abanico para cerrar las vías de escape.
 *    Se quedan inmóviles cada vez que una presa levanta la cabeza.
 *  - charge: carrera de 10–12 s hacia el punto de intercepción de la presa elegida.
 *  - struggle: la presa queda sujeta; con varias leonas el derribo es casi seguro.
 * El éxito no se tira a dados: sale de la detección de las presas (luz, viento, cobertura)
 * y de la persecución real.
 */
export const groupHunt = {
  active: false,
  phase: 'done' as HuntPhase,
  herd: null as Herd | null,
  target: null as PreyAnimal | null,
  hunters: [] as Hunter[],
  timer: 0,
  /** Resultado de la última cacería para el director y los objetivos. */
  lastResult: null as 'success' | 'fail' | null,
  /** El jugador ha seguido la cacería de cerca. */
  playerWatched: false,
  /** Segundos que la manada lleva alerta durante el acecho. */
  alertTime: 0,
};

const tmp = new THREE.Vector3();

export function startGroupHunt(herd: Herd): void {
  groupHunt.active = true;
  groupHunt.phase = 'approach';
  groupHunt.herd = herd;
  groupHunt.target = null;
  groupHunt.timer = 0;
  groupHunt.lastResult = null;
  groupHunt.playerWatched = false;
  groupHunt.alertTime = 0;
  const aunts = prideAunts();
  groupHunt.hunters = [{ agent: mother, side: 0 }, ...aunts.map((a, i) => ({ agent: a as Agent, side: i === 0 ? 1 : -1 }))];
  mother.state = 'groupHunt';
  for (const a of aunts) a.state = 'hunt';
  events.emit('subtitle', {
    text: `${mother.name} y las leonas salen de caza hacia una manada de ${preySpec(herd.species).label.toLowerCase()}s`,
    seconds: 4,
  });
}

function finish(result: 'success' | 'fail'): void {
  groupHunt.active = false;
  groupHunt.phase = 'done';
  groupHunt.lastResult = result;
  if (groupHunt.target && groupHunt.target.state === 'struggle') {
    releasePrey(groupHunt.target, mother.position.x, mother.position.z);
  }
  for (const h of groupHunt.hunters) {
    h.agent.state = 'idle';
    h.agent.timer = 5;
  }
  if (result === 'fail') events.emit('subtitle', { text: 'La cacería ha fracasado: las presas escapan', seconds: 3 });
}

/** Elige la presa: la más cercana y, si la hay, la más pequeña del grupo. */
function chooseTarget(herd: Herd): PreyAnimal | null {
  let best: PreyAnimal | null = null;
  let bestD = Infinity;
  for (const m of herd.members) {
    if (!m.alive) continue;
    const d = distXZ(m.position, mother.position) * (0.85 + ((m.seed * 37) % 10) * 0.03);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function updateGroupHunt(world: WorldData, dt: number): void {
  if (!groupHunt.active) return;
  const herd = groupHunt.herd;
  groupHunt.timer += dt;
  if (!herd || herd.size <= 0 || !mother.alive) {
    finish('fail');
    return;
  }
  if (distXZ(player.position, mother.position) < 60) groupHunt.playerWatched = true;
  // Las que se han separado (p. ej. la madre defendiendo de hienas) no participan este frame.
  const hunters = groupHunt.hunters.filter((h) => h.agent.state === 'groupHunt' || h.agent.state === 'hunt');
  if (hunters.length === 0) return;

  // El objetivo se elige cuando los individuos existen (la manada está cerca del jugador).
  if (!groupHunt.target || !groupHunt.target.alive) {
    groupHunt.target = herd.spawned ? chooseTarget(herd) : null;
    if (groupHunt.target === null && groupHunt.phase !== 'approach') {
      finish('fail');
      return;
    }
  }
  const target = groupHunt.target;
  const aim = target ? target.position : herd.center;
  // Dirección presa → leonas, para colocar las alas.
  tmp.set(mother.position.x - aim.x, 0, mother.position.z - aim.z);
  const dist = tmp.length();
  tmp.normalize();
  const perpX = -tmp.z;
  const perpZ = tmp.x;

  switch (groupHunt.phase) {
    case 'approach': {
      for (const h of hunters) {
        const ox = aim.x + tmp.x * 105 + perpX * h.side * 12;
        const oz = aim.z + tmp.z * 105 + perpZ * h.side * 12;
        steerTowards(h.agent, world, ox, oz, L.trotSpeedMs * 0.7, dt, { stopDistance: 3 });
        h.agent.clip = clipForSpeed(h.agent.speed, 0.86, 'idle');
      }
      // Hasta que la manada no está instanciada (cerca del jugador) no hay acecho.
      if (dist < 115 && herd.spawned) {
        groupHunt.phase = 'stalk';
        groupHunt.timer = 0;
      }
      if (groupHunt.timer > 240) finish('fail');
      break;
    }
    case 'stalk': {
      if (!target) break;
      // Se quedan inmóviles cuando la presa elegida mira o cuando cualquiera de la manada
      // empieza a inquietarse: es la clave para acercarse sin ser vistas.
      let herdUneasy = 0;
      for (const m of herd.members) if (m.alive) herdUneasy = Math.max(herdUneasy, m.awareness);
      const watching = target.vigilant || herdUneasy > 0.35;
      for (const h of hunters) {
        // Las alas abren en abanico y cierran por los lados.
        const flank = h.side === 0 ? 0 : Math.min(35, dist * 0.45);
        const tx = target.position.x + tmp.x * (h.side === 0 ? 0 : dist * 0.55) + perpX * h.side * flank;
        const tz = target.position.z + tmp.z * (h.side === 0 ? 0 : dist * 0.55) + perpZ * h.side * flank;
        steerTowards(h.agent, world, tx, tz, watching ? 0 : L.stalkSpeedMs * 1.6, dt, { stopDistance: 1, turnRate: 1.5 });
        h.agent.clip = h.agent.speed > 0.1 ? 'stalkWalk' : 'stalkIdle';
      }
      const close = hunters.some((h) => distXZ(h.agent.position, target.position) < CHARGE_DISTANCE);
      // Si la manada las ha descubierto y se aleja, pierden la paciencia y cargan desde lejos.
      if (herd.mode === 'alert') groupHunt.alertTime += dt;
      const impatient = groupHunt.alertTime > 7;
      if (close || herd.mode === 'flee' || impatient) {
        groupHunt.phase = 'charge';
        groupHunt.timer = 0;
      } else if (groupHunt.timer > 200) {
        finish('fail');
      }
      break;
    }
    case 'charge': {
      if (!target) break;
      for (const h of hunters) {
        // Interceptan hacia donde corre la presa.
        const lead = 0.5;
        const tx = target.position.x + Math.sin(target.heading) * target.speed * lead;
        const tz = target.position.z + Math.cos(target.heading) * target.speed * lead;
        const fatigue = groupHunt.timer > CHARGE_SECONDS * 0.7 ? 0.8 : 1;
        steerTowards(h.agent, world, tx, tz, CHARGE_SPEED * fatigue, dt, { stopDistance: 0, accel: 6, turnRate: 4.5 });
        h.agent.clip = 'run';
        if (distXZ(h.agent.position, target.position) < 1.7) {
          grabPrey(target);
          groupHunt.phase = 'struggle';
          groupHunt.timer = 0;
          events.emit('sfx', { sound: 'growl', x: target.position.x, y: target.position.y + 0.8, z: target.position.z });
        }
      }
      if (groupHunt.phase === 'charge' && groupHunt.timer > CHARGE_SECONDS) finish('fail');
      break;
    }
    case 'struggle': {
      if (!target) break;
      for (const h of hunters) {
        const a = h.side * 1.2 + 1.5;
        steerTowards(h.agent, world, target.position.x + Math.cos(a) * 1.1, target.position.z + Math.sin(a) * 1.1, L.trotSpeedMs, dt, {
          stopDistance: 0.3,
        });
        h.agent.clip = h.agent.speed > 0.3 ? 'trot' : 'eat';
      }
      const holders = hunters.filter((h) => distXZ(h.agent.position, target.position) < 2.5).length;
      const spec = preySpec(target.species);
      // Una presa grande con una sola leona puede zafarse.
      const escape = holders <= 1 && spec.weightKg > 200 && groupHunt.timer > 2.5 && Math.sin(target.seed) > 0.3;
      if (escape) {
        finish('fail');
      } else if (groupHunt.timer > 3 + spec.weightKg / 150) {
        killPrey(target);
        groupHunt.active = false;
        groupHunt.phase = 'done';
        groupHunt.lastResult = 'success';
        for (const h of groupHunt.hunters) h.agent.state = 'eat';
        mother.timer = 100;
        events.emit('subtitle', { text: `¡Las leonas han abatido un ${spec.label.toLowerCase()}!`, seconds: 3.5 });
        if (groupHunt.playerWatched) {
          recordMilestone('watched-hunt', `Presenciaste tu primera cacería: un ${spec.label.toLowerCase()}`);
        }
        journal.stats.huntsWatched++;
      }
      break;
    }
  }
}

export function resetGroupHunt(): void {
  groupHunt.active = false;
  groupHunt.phase = 'done';
  groupHunt.herd = null;
  groupHunt.target = null;
  groupHunt.hunters = [];
  groupHunt.lastResult = null;
}
