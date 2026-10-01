import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useQuality, useWorld } from '../core/store';
import { buildChunkGeometry, createDetailTexture, LOD_STEPS } from './terrainChunk';

interface ChunkRecord {
  cx: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  mesh: THREE.Mesh;
  lod: number;
  geometries: (THREE.BufferGeometry | null)[];
}

/** Cuántas geometrías nuevas se pueden construir por frame una vez en juego. */
const BUILD_BUDGET_PER_FRAME = 3;
/** Histéresis para no oscilar entre dos LOD en el borde. */
const LOD_HYSTERESIS = 25;

/**
 * Terreno de 4×4 km dividido en 16×16 chunks con 4 niveles de detalle.
 * Se gestiona de forma imperativa (256 mallas) para no pasar por la reconciliación de React.
 */
export function Terrain() {
  const world = useWorld();
  const quality = useQuality();

  const material = useMemo(() => {
    const detail = createDetailTexture();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
    // La textura de detalle promedia ~0.66: se compensa para conservar el albedo del mapa.
    mat.color.setScalar(1.5);
    return mat;
  }, []);

  const { group, chunks } = useMemo(() => {
    const group = new THREE.Group();
    group.name = 'terrain';
    const chunks: ChunkRecord[] = [];
    const cps = world.chunksPerSide;
    for (let cz = 0; cz < cps; cz++) {
      for (let cx = 0; cx < cps; cx++) {
        const mesh = new THREE.Mesh(undefined, material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        group.add(mesh);
        const minX = -world.half + cx * world.chunkSize;
        const minZ = -world.half + cz * world.chunkSize;
        chunks.push({
          cx,
          cz,
          minX,
          minZ,
          maxX: minX + world.chunkSize,
          maxZ: minZ + world.chunkSize,
          mesh,
          lod: -1,
          geometries: LOD_STEPS.map(() => null),
        });
      }
    }
    return { group, chunks };
  }, [world, material]);

  useEffect(
    () => () => {
      for (const c of chunks) for (const g of c.geometries) g?.dispose();
      material.map?.dispose();
      material.dispose();
    },
    [chunks, material],
  );

  const state = useMemo(() => ({ timer: 0, firstPass: true }), []);

  useFrame(({ camera }, dt) => {
    state.timer -= dt;
    if (state.timer > 0 && !state.firstPass) return;
    state.timer = 0.2;

    const [l1, l2, l3] = quality.terrainLod;
    const px = camera.position.x;
    const pz = camera.position.z;
    let budget = state.firstPass ? Infinity : BUILD_BUDGET_PER_FRAME;

    // Los chunks más cercanos se atienden primero.
    const ordered = chunks
      .map((c) => {
        const dx = Math.max(c.minX - px, 0, px - c.maxX);
        const dz = Math.max(c.minZ - pz, 0, pz - c.maxZ);
        return { c, d: Math.hypot(dx, dz) };
      })
      .sort((a, b) => a.d - b.d);

    const lodFor = (d: number) => (d < l1 ? 0 : d < l2 ? 1 : d < l3 ? 2 : 3);

    for (const { c, d } of ordered) {
      const target = lodFor(d);
      if (target === c.lod) continue;
      // Histéresis: si con un pequeño margen seguiríamos en el LOD actual, no cambiamos.
      if (c.lod >= 0 && (lodFor(d - LOD_HYSTERESIS) === c.lod || lodFor(d + LOD_HYSTERESIS) === c.lod)) {
        continue;
      }
      let geometry = c.geometries[target];
      if (!geometry) {
        if (budget <= 0) continue;
        geometry = buildChunkGeometry(world, c.cx, c.cz, target);
        c.geometries[target] = geometry;
        budget--;
      }
      c.mesh.geometry = geometry;
      c.mesh.visible = true;
      c.lod = target;
    }
    state.firstPass = false;
  });

  return <primitive object={group} />;
}
