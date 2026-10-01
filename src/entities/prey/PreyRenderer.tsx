import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import preyData from '../../data/prey.json';
import { damp } from '../../core/math';
import { useGame, useWorld } from '../../core/store';
import { player } from '../player/playerState';
import { PreyActor } from './PreyActor';
import { preyGeometry, type PreySpecies } from './preyRig';
import { herds, type PreyAnimal } from './preyState';

const SPECIES = Object.keys(preyData.species) as PreySpecies[];
const DETAIL_RADIUS = preyData.herds.detailRadius;
const MAX_DETAILED = 48;
const FAR_CAPACITY = 160;

/**
 * Render de las presas con dos niveles de detalle: cerca, actores animados (esqueleto +
 * mezclador); lejos, un InstancedMesh estático por especie (una draw call cada una).
 */
export function PreyRenderer() {
  const world = useWorld();
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useMemo(() => new Map<string, { actor: PreyActor; pitch: number }>(), []);

  const far = useMemo(() => {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const meshes = {} as Record<PreySpecies, THREE.InstancedMesh>;
    for (const s of SPECIES) {
      // Geometría en pose de reposo (los atributos de piel se ignoran sin esqueleto).
      const geometry = preyGeometry(s, 2);
      const im = new THREE.InstancedMesh(geometry, material, FAR_CAPACITY);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;
      meshes[s] = im;
    }
    return { material, meshes };
  }, []);

  useEffect(() => {
    for (const m of Object.values(far.meshes)) group.add(m);
    return () => {
      // La geometría es la caché compartida de preyRig: no se libera aquí.
      for (const m of Object.values(far.meshes)) m.dispose();
      far.material.dispose();
    };
  }, [far, group]);
  useEffect(
    () => () => {
      for (const v of pool.values()) v.actor.dispose();
      pool.clear();
    },
    [pool],
  );

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }),
    [],
  );

  useFrame((_, rawDt) => {
    if (useGame.getState().phase === 'paused') return;
    const dt = Math.min(rawDt, 0.05);

    // Ordena los individuos por distancia al jugador.
    const visible: { a: PreyAnimal; d: number }[] = [];
    for (const h of herds) {
      if (!h.spawned) continue;
      for (const a of h.members) {
        if (!a.alive) continue;
        visible.push({ a, d: Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z) });
      }
    }
    visible.sort((x, y) => x.d - y.d);

    const detailed = new Set<string>();
    const counts = Object.fromEntries(SPECIES.map((s) => [s, 0])) as Record<PreySpecies, number>;
    for (const { a, d } of visible) {
      if (d < DETAIL_RADIUS && detailed.size < MAX_DETAILED) {
        detailed.add(a.id);
        let view = pool.get(a.id);
        if (!view) {
          view = { actor: new PreyActor(a.species, a.seed), pitch: 0 };
          pool.set(a.id, view);
          group.add(view.actor.object);
        }
        const actor = view.actor;
        actor.play(a.clip, a.clip === 'run' ? 0.15 : 0.4);
        actor.matchSpeed(a.speed);
        actor.update(dt);
        const reach = 0.7 * actor.scale;
        const hF = world.heightAt(a.position.x + Math.sin(a.heading) * reach, a.position.z + Math.cos(a.heading) * reach);
        const hB = world.heightAt(a.position.x - Math.sin(a.heading) * reach, a.position.z - Math.cos(a.heading) * reach);
        view.pitch = damp(view.pitch, Math.atan2(hF - hB, 2 * reach), 8, dt);
        actor.object.position.copy(a.position);
        actor.object.rotation.y = a.heading;
        actor.body.rotation.x = -view.pitch;
      } else {
        const im = far.meshes[a.species];
        const i = counts[a.species]++;
        if (i >= FAR_CAPACITY) continue;
        const scale = preyData.species[a.species].scale;
        tmp.q.setFromAxisAngle(tmp.up, a.heading);
        tmp.s.setScalar(scale);
        im.setMatrixAt(i, tmp.m.compose(a.position, tmp.q, tmp.s));
      }
    }
    for (const s of SPECIES) {
      const im = far.meshes[s];
      im.count = Math.min(counts[s], FAR_CAPACITY);
      im.instanceMatrix.needsUpdate = true;
    }
    for (const [id, view] of pool) {
      if (detailed.has(id)) continue;
      group.remove(view.actor.object);
      view.actor.dispose();
      pool.delete(id);
    }
  });

  return <primitive object={group} />;
}
