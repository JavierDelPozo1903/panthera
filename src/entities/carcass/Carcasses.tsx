import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGame } from '../../core/store';
import { mother } from '../npc/npcState';
import { PreyActor } from '../prey/PreyActor';
import { carcasses } from './carcassState';

/** Tiempo de la animación de caída tras el cual el cuerpo queda inmóvil. */
const SETTLE_SECONDS = 1.7;

interface CarcassView {
  actor: PreyActor;
  settle: number;
}

/**
 * Presas abatidas: se dibujan con el propio modelo de la especie en pose de muerte, y se
 * van oscureciendo a medida que se consume la carne. Incluye la presa que la madre trae en
 * la boca al volver de caza.
 */
export function Carcasses() {
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useMemo(() => new Map<number, CarcassView>(), []);
  const carried = useMemo(() => {
    const a = new PreyActor('impala', 3);
    a.play('die', 0);
    a.update(SETTLE_SECONDS);
    a.object.scale.setScalar(0.85);
    return a;
  }, []);
  useEffect(
    () => () => {
      for (const v of pool.values()) v.actor.dispose();
      pool.clear();
      carried.dispose();
    },
    [pool, carried],
  );

  useFrame((_, rawDt) => {
    if (useGame.getState().phase === 'paused') return;
    const dt = Math.min(rawDt, 0.05);
    const seen = new Set<number>();
    for (const c of carcasses) {
      seen.add(c.id);
      let view = pool.get(c.id);
      if (!view) {
        const actor = new PreyActor(c.species, c.id * 7 + 1);
        actor.play('die', 0.05);
        view = { actor, settle: 0 };
        pool.set(c.id, view);
        group.add(actor.object);
      }
      if (view.settle < SETTLE_SECONDS) {
        view.settle += dt;
        view.actor.update(dt);
      }
      view.actor.object.position.copy(c.position);
      view.actor.object.rotation.y = c.heading - Math.PI / 2;
      // Se va quedando en los huesos: tonos de carne y sangre.
      const left = c.meatKg / c.maxKg;
      const mat = (view.actor.mesh.material as THREE.MeshStandardMaterial).color;
      mat.setRGB(0.55 + 0.45 * left, 0.3 + 0.7 * left, 0.28 + 0.72 * left);
    }
    for (const [id, view] of pool) {
      if (seen.has(id)) continue;
      group.remove(view.actor.object);
      view.actor.dispose();
      pool.delete(id);
    }

    // Presa en la boca de la madre al volver de caza.
    carried.object.visible = mother.active && mother.carrying && mother.state !== 'away';
    if (carried.object.visible) {
      const s = 0.86;
      carried.object.position.set(
        mother.position.x + Math.sin(mother.heading) * 1.3 * s,
        mother.position.y + 0.25,
        mother.position.z + Math.cos(mother.heading) * 1.3 * s,
      );
      carried.object.rotation.set(0, mother.heading + Math.PI / 2, 0);
    }
  });

  return (
    <>
      <primitive object={group} />
      <primitive object={carried.object} />
    </>
  );
}
