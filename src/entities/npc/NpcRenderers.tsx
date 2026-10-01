import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { damp } from '../../core/math';
import { useGame, useWorld } from '../../core/store';
import { GROWTH_STEP_YEARS } from '../../systems/lifeStage';
import type { WorldData } from '../../world/WorldData';
import type { AnimalActor } from '../animal/AnimalActor';
import { HyenaActor } from '../hyena/HyenaActor';
import { LionActor } from '../lion/LionActor';
import { player } from '../player/playerState';
import { hyenas, mother, pride, siblings, type Agent } from './npcState';

/** Pendiente suavizada por actor. */
const pitchOf = new WeakMap<AnimalActor, number>();

/** Copia la simulación de un agente a su actor: posición, rumbo, inclinación y animación. */
function syncActor(actor: AnimalActor, agent: Agent, world: WorldData, dt: number): void {
  const reach = 0.8 * actor.scale;
  const fx = Math.sin(agent.heading);
  const fz = Math.cos(agent.heading);
  const hF = world.heightAt(agent.position.x + fx * reach, agent.position.z + fz * reach);
  const hB = world.heightAt(agent.position.x - fx * reach, agent.position.z - fz * reach);
  const pitch = damp(pitchOf.get(actor) ?? 0, Math.atan2(hF - hB, 2 * reach), 8, dt);
  pitchOf.set(actor, pitch);

  const fade = agent.clip === 'rest' || actor.currentClip === 'rest' || agent.clip === 'die' ? 0.9 : 0.3;
  actor.play(agent.clip, fade);
  actor.matchSpeed(agent.speed);
  actor.update(dt);
  actor.object.position.copy(agent.position);
  actor.object.rotation.y = agent.heading;
  actor.body.rotation.x = agent.clip === 'die' ? 0 : -pitch;
}

const paused = () => useGame.getState().phase === 'paused';

/** La madre: visible mientras cría (cachorro y juvenil) y no está lejos cazando. */
export function MotherLion() {
  const world = useWorld();
  const lifeStage = useGame((s) => s.lifeStage);
  const active = lifeStage === 'cub' || lifeStage === 'juvenile';
  const actor = useMemo(() => new LionActor({ sex: 'female', ageYears: 7, maneDarkness: 0, furTint: -0.6 }), []);
  useEffect(() => () => actor.dispose(), [actor]);
  useEffect(() => {
    mother.active = active;
  }, [active]);

  useFrame((_, rawDt) => {
    if (!active || paused()) return;
    const dt = Math.min(rawDt, 0.05);
    actor.object.visible = mother.state !== 'away';
    syncActor(actor, mother, world, dt);
  }, -34);

  if (!active) return null;
  return <primitive object={actor.object} />;
}

/** Hermanos de camada: crecen al mismo ritmo que el jugador. */
export function Siblings() {
  const world = useWorld();
  const growthStep = useGame((s) => s.growthStep);
  const family = useGame((s) => s.familyVersion);
  const actors = useMemo(
    () =>
      siblings.map(
        (s) =>
          new LionActor({
            sex: s.sex,
            ageYears: Math.max(s.ageYears, growthStep * GROWTH_STEP_YEARS),
            maneDarkness: 0.4,
            furTint: s.sex === 'male' ? 0.4 : 0.2,
          }),
      ),
    // `family` fuerza la reconstrucción cuando cambia la camada (nueva vida, legado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [growthStep, family],
  );
  useEffect(() => () => actors.forEach((a) => a.dispose()), [actors]);

  useFrame((_, rawDt) => {
    if (paused()) return;
    const dt = Math.min(rawDt, 0.05);
    siblings.forEach((s, i) => {
      const a = actors[i];
      if (!a) return;
      s.ageYears = player.ageYears;
      syncActor(a, s, world, dt);
    });
  }, -34);

  return (
    <>
      {actors.map((a) => (
        <primitive key={a.object.uuid} object={a.object} />
      ))}
    </>
  );
}

/** Tías y macho residente. */
export function PrideLions() {
  const world = useWorld();
  const family = useGame((s) => s.familyVersion);
  const actors = useMemo(
    () =>
      pride.map((p) =>
        p.role === 'father'
          ? new LionActor({ sex: 'male', ageYears: 8, maneDarkness: 0.85 })
          : new LionActor({ sex: 'female', ageYears: p.ageYears, maneDarkness: 0, furTint: p.side * 0.4 }),
      ),
    // `family` fuerza la reconstrucción cuando cambia la manada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [family],
  );
  useEffect(() => () => actors.forEach((a) => a.dispose()), [actors]);

  useFrame((_, rawDt) => {
    if (paused()) return;
    const dt = Math.min(rawDt, 0.05);
    pride.forEach((p, i) => {
      const a = actors[i];
      if (a) syncActor(a, p, world, dt);
    });
  }, -34);

  return (
    <>
      {actors.map((a) => (
        <primitive key={a.object.uuid} object={a.object} />
      ))}
    </>
  );
}

/** Hienas: los actores se crean y destruyen al ritmo al que aparecen y se marchan. */
export function Hyenas() {
  const world = useWorld();
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useMemo(() => new Map<string, HyenaActor>(), []);
  useEffect(
    () => () => {
      for (const a of pool.values()) a.dispose();
      pool.clear();
    },
    [pool],
  );

  useFrame((_, rawDt) => {
    if (paused()) return;
    const dt = Math.min(rawDt, 0.05);
    const alive = new Set<string>();
    for (const h of hyenas) {
      alive.add(h.id);
      let actor = pool.get(h.id);
      if (!actor) {
        actor = new HyenaActor(h.seed);
        pool.set(h.id, actor);
        group.add(actor.object);
      }
      syncActor(actor, h, world, dt);
    }
    for (const [id, actor] of pool) {
      if (alive.has(id)) continue;
      group.remove(actor.object);
      actor.dispose();
      pool.delete(id);
    }
  }, -34);

  return <primitive object={group} />;
}
