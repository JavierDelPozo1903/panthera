import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { director, updateDirector } from '../ai/director';
import { updateHyenas } from '../ai/hyenaBrain';
import { updateMother } from '../ai/motherBrain';
import { updatePrey } from '../ai/preyBrain';
import { updatePride } from '../ai/prideBrain';
import { updateSiblings } from '../ai/siblingBrain';
import { updateWildLions } from '../ai/wildLionBrain';
import { updateCarcasses } from '../entities/carcass/carcassState';
import { mother, siblings } from '../entities/npc/npcState';
import { wildLions } from '../entities/npc/wildLions';
import { player } from '../entities/player/playerState';
import { updateExploration } from '../systems/exploration';
import { journal, recordMilestone } from '../systems/journal';
import { updateNeeds, type Activity } from '../systems/needs';
import { updateObjectiveTriggers } from '../systems/objectives';
import { updateCombat } from '../systems/combat';
import { updateLifeRole } from '../systems/lifeRole';
import { updateReproduction } from '../systems/reproduction';
import { BODY_PART_LABEL, partWithArticle, playerBody, updateWounds } from '../systems/wounds';
import { pruneMarks } from '../world/territories';
import { clock } from './clock';
import { events } from './events';
import { mulberry32 } from './math';
import { useGame, useWorld } from './store';

const CAUSE_TEXT = {
  hyenas: 'Atacado por un clan de hienas',
  starvation: 'Murió de hambre',
  thirst: 'Murió de sed',
  prey: 'Herido de muerte por una presa',
  lions: 'Muerto en una pelea con otros leones',
  wounds: 'Sus heridas se infectaron',
} as const;

/**
 * Simulación de la vida: necesidades del jugador, IA (madre, hermanos, hienas), presas,
 * director de eventos, objetivos y muerte. Corre tras el jugador (−40) y antes de la
 * cámara (−30).
 */
export function Simulation() {
  const world = useWorld();
  const rng = useMemo(() => mulberry32(Date.now() & 0xffff), []);
  const st = useMemo(() => ({ deathTimer: 0, lastDays: clock.totalDays, exploreTimer: 0 }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const phase = useGame.getState().phase;
    const days = clock.totalDays;
    const gameHours = Math.max(0, (days - st.lastDays) * 24);
    st.lastDays = days;
    if (phase !== 'playing') return;

    // --- Jugador ---
    if (player.alive) {
      const nearFamily =
        (mother.active && mother.state !== 'away' && dist(player.position, mother.position) < 12) ||
        siblings.some((s) => s.alive && dist(player.position, s.position) < 8);
      updateNeeds({
        gameHours,
        dt,
        activity: activityOf(),
        isCub: player.ageYears < 1,
        nearFamily,
      });
      updatePlayerWounds(gameHours);
      if (player.needs.health <= 0.001) die();
    } else {
      st.deathTimer += dt;
      if (st.deathTimer > 3.5 && useGame.getState().phase === 'playing') {
        useGame.setState({
          phase: 'dead',
          deathInfo: {
            cause: CAUSE_TEXT[player.causeOfDeath ?? 'hyenas'],
            ageYears: player.ageYears,
            day: clock.day + 1,
          },
        });
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }

    // --- Mundo vivo ---
    if (mother.active) updateMother(world, dt, rng);
    updatePride(world, dt, rng);
    updatePrey(world, dt, rng, director.elapsed);
    updateSiblings(world, dt, rng);
    updateHyenas(world, dt, rng);
    updateCarcasses(dt);
    updateWildLions(world, dt, rng);
    updateCombat(world, dt, rng);
    updateLifeRole(world, dt, rng);
    updateReproduction(world, gameHours / 24, dt, rng);
    if (gameHours > 0) updateWildBodies(gameHours);
    updateDirector(world, dt, rng);
    updateObjectiveTriggers(dt);
    st.exploreTimer -= dt;
    if (st.exploreTimer <= 0) {
      st.exploreTimer = 0.5;
      updateExploration(world.size, clock.totalDays);
      pruneMarks();
    }
  }, -38);

  function updatePlayerWounds(gameHours: number) {
    const tick = updateWounds(playerBody, gameHours, player.resting, rng);
    if (tick.healthDelta < 0) {
      player.needs.health = Math.max(0, player.needs.health + tick.healthDelta);
      if (playerBody.wounds.some((w) => w.infected)) player.lastDamage = 'wounds';
    }
    for (const w of tick.newlyInfected) {
      events.emit('subtitle', { text: `La herida de tu ${BODY_PART_LABEL[w.part]} se ha infectado: descansa (Z) para curarla`, seconds: 5 });
    }
    for (const part of tick.newScars) {
      events.emit('subtitle', { text: `La herida de tu ${BODY_PART_LABEL[part]} cicatriza: te quedará la marca`, seconds: 4 });
      recordMilestone(`scar:${part}`, `Una cicatriz en ${partWithArticle(part)} recuerda una pelea`);
    }
  }

  function die() {
    player.alive = false;
    player.action = null;
    player.causeOfDeath = player.lastDamage ?? 'starvation';
    st.deathTimer = 0;
    journal.entries.push({
      id: 'death',
      text: CAUSE_TEXT[player.causeOfDeath],
      day: clock.day + 1,
      time: clock.formatTime(),
      age: '',
    });
    events.emit('player:died', { cause: player.causeOfDeath });
    director.danger = 0;
  }

  return null;
}

/** Heridas y recuperación de los leones ajenos (por horas de juego). */
function updateWildBodies(gameHours: number): void {
  for (const l of wildLions) {
    if (!l.alive) continue;
    const tick = updateWounds(l.body, gameHours, l.state === 'rest', Math.random);
    l.health = Math.min(1, Math.max(0, l.health + tick.healthDelta + (l.body.wounds.length === 0 ? 0.04 * gameHours : 0)));
    if (l.health <= 0) {
      l.alive = false;
      l.state = 'dead';
      l.clip = 'die';
    }
  }
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function activityOf(): Activity {
  if (player.resting || player.action === 'nurse') return 'rest';
  if (player.swimming) return 'swim';
  if (player.gait === 'run') return 'run';
  if (player.gait === 'trot') return 'trot';
  if (player.speed > 0.2) return 'walk';
  return 'idle';
}
