import * as THREE from 'three';
import lionData from '../data/lion.json';
import { events } from '../core/events';
import { eatFrom, nearestCarcass } from '../entities/carcass/carcassState';
import { hyenas, mother, siblings, type Agent, type SiblingState } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { lionScale } from '../entities/lion/lionRig';
import { physicalMaturity } from '../systems/lifeStage';
import type { WorldData } from '../world/WorldData';
import { clipForSpeed, distXZ, steerTowards } from './steering';

const L = lionData.locomotion;
const tmp = new THREE.Vector3();

/** El jugador ha caído sobre este hermano tras un salto: se revuelca y luego contraataca. */
export function tumbleSibling(s: Agent<SiblingState>): void {
  s.state = 'tumble';
  s.timer = 1.6;
  events.emit('sfx', { sound: 'pounce', x: s.position.x, y: s.position.y, z: s.position.z, volume: 0.6 });
}

function threatened(s: Agent<SiblingState>): boolean {
  return hyenas.some(
    (h) =>
      h.alive &&
      (h.targetId === s.id || ((h.state === 'chase' || h.state === 'attack') && distXZ(h.position, s.position) < 25)),
  );
}

/**
 * Hermanos de camada: siguen a la madre, juegan entre ellos y con el jugador (entrenando la
 * caza), maman y comen con ella, y se esconden o huyen hacia ella ante las hienas.
 */
export function updateSiblings(world: WorldData, dt: number, rng: () => number): void {
  siblings.forEach((s, index) => {
    if (!s.alive) {
      s.clip = 'die';
      s.speed = 0;
      return;
    }
    s.timer -= dt;
    const ability = 0.42 + 0.58 * physicalMaturity(s.ageYears);
    const scale = lionScale({ sex: s.sex, ageYears: s.ageYears, maneDarkness: 0 });
    const motherHere = mother.active && mother.alive && mother.state !== 'away' && mother.state !== 'huntLeave';
    let speed = 0;
    let tx = s.position.x;
    let tz = s.position.z;
    let still: typeof s.clip = 'idle';

    // Peligro: huir hacia la madre o quedarse agazapado si no está.
    if (s.state !== 'tumble' && threatened(s)) s.state = motherHere ? 'flee' : 'hide';

    // Puesto alrededor de la madre (cada hermano a un lado).
    const side = index === 0 ? 1 : -1;
    const anchorX = mother.position.x + Math.cos(mother.heading + side * 2.2) * 2.4;
    const anchorZ = mother.position.z + Math.sin(mother.heading + side * 2.2) * 2.4;

    switch (s.state) {
      case 'tumble':
        still = 'rest';
        if (s.timer <= 0) {
          s.state = 'play';
          s.timer = 5 + rng() * 4;
          s.target.set(player.position.x, 0, player.position.z);
        }
        break;
      case 'flee':
        tx = mother.position.x;
        tz = mother.position.z;
        speed = L.trotSpeedMs * 1.6 * ability;
        if (distXZ(s.position, mother.position) < 3 && !threatened(s)) s.state = 'follow';
        break;
      case 'hide':
        still = 'stalkIdle';
        if (!threatened(s) && s.timer <= 0) s.state = 'follow';
        s.timer = Math.max(s.timer, 3);
        break;
      case 'play': {
        // Persigue al jugador o al otro hermano: así entrenan el acecho.
        const other = siblings[1 - index];
        const targetPlayer = player.alive && distXZ(s.position, player.position) < 18;
        if (targetPlayer) s.target.set(player.position.x, 0, player.position.z);
        else if (other?.alive) s.target.set(other.position.x, 0, other.position.z);
        tx = s.target.x;
        tz = s.target.z;
        speed = L.trotSpeedMs * ability * 1.1;
        if (s.timer <= 0 || !motherHere) s.state = 'follow';
        break;
      }
      case 'nurse':
      case 'eat':
      case 'rest':
      case 'follow': {
        const c = mother.state === 'eat' ? nearestCarcass(mother.position.x, mother.position.z, 8) : null;
        if (c) {
          // Comer junto a la presa.
          tmp.set(c.position.x + Math.cos(index * 2 + 1) * 1.2, 0, c.position.z + Math.sin(index * 2 + 1) * 1.2);
          tx = tmp.x;
          tz = tmp.z;
          if (distXZ(s.position, tmp) > 0.6) speed = L.trotSpeedMs * ability;
          else {
            still = 'eat';
            eatFrom(c, 0.02 * dt);
          }
          s.state = 'eat';
        } else if (!motherHere) {
          // Madre cazando: se quedan tumbados y quietos en la madriguera.
          tx = mother.home.x + side * 1.5;
          tz = mother.home.z + 1;
          speed = distXZ(s.position, { x: tx, z: tz }) > 1.5 ? L.walkSpeedMs * ability : 0;
          still = 'rest';
          s.state = 'rest';
        } else if (mother.state === 'rest' || mother.state === 'nurse') {
          tx = anchorX;
          tz = anchorZ;
          speed = distXZ(s.position, { x: tx, z: tz }) > 0.8 ? L.walkSpeedMs * ability * 1.4 : 0;
          still = mother.state === 'nurse' ? 'nurse' : 'rest';
          s.state = mother.state === 'nurse' ? 'nurse' : 'rest';
          if (s.timer <= 0 && mother.state === 'rest' && rng() < 0.5) {
            s.state = 'play';
            s.timer = 6 + rng() * 6;
          } else if (s.timer <= 0) s.timer = 15 + rng() * 25;
        } else {
          // La madre se mueve: la siguen de cerca.
          tx = anchorX;
          tz = anchorZ;
          const d = distXZ(s.position, { x: tx, z: tz });
          speed = d > 6 ? L.trotSpeedMs * ability * 1.2 : d > 1 ? L.walkSpeedMs * ability * 1.3 : 0;
          s.state = 'follow';
          if (s.timer <= 0) s.timer = 10 + rng() * 20;
        }
        break;
      }
      case 'dead':
        break;
    }

    steerTowards(s, world, tx, tz, speed, dt, { stopDistance: s.state === 'play' ? 1.2 : 0.4, accel: 4, turnRate: 4 });
    s.clip = clipForSpeed(s.speed, scale, still);
  });
}

/** Daño a un hermano; si muere, la tragedia queda en el diario. */
export function damageSibling(s: Agent<SiblingState>, amount: number): void {
  if (!s.alive) return;
  s.health -= amount;
  if (s.health <= 0) {
    s.alive = false;
    s.state = 'dead';
    s.health = 0;
    events.emit('subtitle', { text: `${s.name} no ha sobrevivido al ataque de las hienas`, seconds: 5 });
  }
}
