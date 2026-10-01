import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo } from 'react';
import { useWorld } from '../core/store';
import { player } from '../entities/player/playerState';
import { getVegetation } from './vegetationData';

type RapierWorld = ReturnType<typeof useRapier>['world'];
type Collider = ReturnType<RapierWorld['createCollider']>;

/** Radio en chunks alrededor del jugador con colisiones activas (1 → 3×3 chunks). */
const ACTIVE_RING = 1;

/**
 * Streaming de colisionadores estáticos (troncos, rocas, chozas) alrededor del jugador.
 * El terreno no necesita colisionador: se resuelve analíticamente con el heightmap.
 */
export function ObstacleColliders() {
  const { world: physics, rapier } = useRapier();
  const world = useWorld();
  const vegetation = getVegetation(world);
  const active = useMemo(() => new Map<number, Collider[]>(), []);
  const state = useMemo(() => ({ timer: 0, lastChunk: -1 }), []);

  useEffect(
    () => () => {
      for (const list of active.values()) for (const c of list) physics.removeCollider(c, false);
      active.clear();
    },
    [physics, active],
  );

  useFrame((_, dt) => {
    state.timer -= dt;
    if (state.timer > 0) return;
    state.timer = 0.3;

    const cps = world.chunksPerSide;
    const pcx = Math.floor((player.position.x + world.half) / world.chunkSize);
    const pcz = Math.floor((player.position.z + world.half) / world.chunkSize);
    const current = pcz * cps + pcx;
    if (current === state.lastChunk) return;
    state.lastChunk = current;

    const wanted = new Set<number>();
    for (let dz = -ACTIVE_RING; dz <= ACTIVE_RING; dz++) {
      for (let dx = -ACTIVE_RING; dx <= ACTIVE_RING; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (cx >= 0 && cz >= 0 && cx < cps && cz < cps) wanted.add(cz * cps + cx);
      }
    }

    for (const [index, list] of active) {
      if (wanted.has(index)) continue;
      for (const c of list) physics.removeCollider(c, false);
      active.delete(index);
    }

    for (const index of wanted) {
      if (active.has(index)) continue;
      const list: Collider[] = [];
      for (const o of vegetation[index].obstacles) {
        const desc =
          o.shape === 'ball'
            ? rapier.ColliderDesc.ball(o.radius).setTranslation(o.x, o.y, o.z)
            : rapier.ColliderDesc.cylinder(o.halfHeight, o.radius).setTranslation(o.x, o.y + o.halfHeight, o.z);
        list.push(physics.createCollider(desc));
      }
      active.set(index, list);
    }
  });

  return null;
}
