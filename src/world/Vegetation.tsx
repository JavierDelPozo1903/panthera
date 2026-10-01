import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { useQuality, useWorld } from '../core/store';
import { getVegetation, INSTANCE_STRIDE, type VegKind } from './vegetationData';
import { createAcacia, createBoulder, createBush, createHut, createRiparianTree } from './vegetationModels';

type ModelKey = 'acaciaHi' | 'acaciaLo' | 'riparianHi' | 'riparianLo' | 'bush' | 'boulder' | 'hut';

interface ChunkMeshes {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  meshes: Partial<Record<ModelKey, THREE.InstancedMesh>>;
}

const MODEL_SOURCE: Record<ModelKey, VegKind> = {
  acaciaHi: 'acacia',
  acaciaLo: 'acacia',
  riparianHi: 'riparian',
  riparianLo: 'riparian',
  bush: 'bush',
  boulder: 'boulder',
  hut: 'hut',
};

/** Árboles, arbustos, rocas y chozas instanciados por chunk, con LOD y distancia de dibujado. */
export function Vegetation() {
  const world = useWorld();
  const quality = useQuality();

  const models = useMemo<Record<ModelKey, THREE.BufferGeometry>>(
    () => ({
      acaciaHi: createAcacia(false),
      acaciaLo: createAcacia(true),
      riparianHi: createRiparianTree(false),
      riparianLo: createRiparianTree(true),
      bush: createBush(),
      boulder: createBoulder(),
      hut: createHut(),
    }),
    [],
  );
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
    [],
  );

  const { group, chunks } = useMemo(() => {
    const data = getVegetation(world);
    const group = new THREE.Group();
    group.name = 'vegetation';
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    const chunks: ChunkMeshes[] = data.map((chunk) => {
      const cps = world.chunksPerSide;
      const cx = chunk.index % cps;
      const cz = Math.floor(chunk.index / cps);
      const minX = -world.half + cx * world.chunkSize;
      const minZ = -world.half + cz * world.chunkSize;
      const record: ChunkMeshes = { minX, minZ, maxX: minX + world.chunkSize, maxZ: minZ + world.chunkSize, meshes: {} };
      const rng = mulberry32(chunk.index + 17);

      for (const key of Object.keys(MODEL_SOURCE) as ModelKey[]) {
        const values = chunk.instances[MODEL_SOURCE[key]];
        const count = values.length / INSTANCE_STRIDE;
        if (count === 0) continue;
        const mesh = new THREE.InstancedMesh(models[key], material, count);
        for (let i = 0; i < count; i++) {
          const o = i * INSTANCE_STRIDE;
          const s = values[o + 3];
          pos.set(values[o], values[o + 1], values[o + 2]);
          quat.setFromAxisAngle(up, values[o + 4]);
          scl.set(s, s * values[o + 5], s);
          mesh.setMatrixAt(i, matrix.compose(pos, quat, scl));
          const tint = 0.86 + rng() * 0.26;
          mesh.setColorAt(i, color.setRGB(tint, tint * (0.96 + rng() * 0.08), tint * 0.95));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = key !== 'acaciaLo' && key !== 'riparianLo';
        mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        record.meshes[key] = mesh;
        group.add(mesh);
      }
      return record;
    });
    return { group, chunks };
  }, [world, models, material]);

  useEffect(
    () => () => {
      for (const c of chunks) for (const m of Object.values(c.meshes)) m?.dispose();
    },
    [chunks],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(models)) g.dispose();
      material.dispose();
    },
    [models, material],
  );

  const state = useMemo(() => ({ timer: 0 }), []);
  useFrame(({ camera }, dt) => {
    state.timer -= dt;
    if (state.timer > 0) return;
    state.timer = 0.25;
    const px = camera.position.x;
    const pz = camera.position.z;
    for (const c of chunks) {
      const dx = Math.max(c.minX - px, 0, px - c.maxX);
      const dz = Math.max(c.minZ - pz, 0, pz - c.maxZ);
      const d = Math.hypot(dx, dz);
      const hi = d < quality.treeLodDistance;
      const inView = d < quality.treeViewDistance;
      const m = c.meshes;
      if (m.acaciaHi) m.acaciaHi.visible = hi;
      if (m.riparianHi) m.riparianHi.visible = hi;
      if (m.acaciaLo) m.acaciaLo.visible = !hi && inView;
      if (m.riparianLo) m.riparianLo.visible = !hi && inView;
      if (m.bush) m.bush.visible = d < quality.bushViewDistance;
      if (m.boulder) m.boulder.visible = d < quality.treeViewDistance * 1.3;
      if (m.hut) m.hut.visible = d < quality.treeViewDistance;
    }
  });

  return <primitive object={group} />;
}
