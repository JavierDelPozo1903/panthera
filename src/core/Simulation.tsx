import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { director, updateDirector } from '../ai/director';
import { updateHyenas } from '../ai/hyenaBrain';
import { updateMother } from '../ai/motherBrain';
import { updatePrey } from '../ai/preyBrain';
import { updatePride } from '../ai/prideBrain';
import { updateSiblings } from '../ai/siblingBrain';
import { updateCarcasses } from '../entities/carcass/carcassState';
import { mother, siblings } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { updateExploration } from '../systems/exploration';
import { journal } from '../systems/journal';
import { updateNeeds, type Activity } from '../systems/needs';
import { updateObjectiveTriggers } from '../systems/objectives';
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
    updateDirector(world, dt, rng);
    updateObjectiveTriggers(dt);
    st.exploreTimer -= dt;
    if (st.exploreTimer <= 0) {
      st.exploreTimer = 0.5;
      updateExploration(world.size, clock.totalDays);
    }
  }, -38);

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
