import { mulberry32 } from '../core/math';
import { BIOMES, Biome } from './biomes';
import { createNoise2D } from './noise';
import type { WorldData } from './WorldData';

export type VegKind = 'acacia' | 'riparian' | 'bush' | 'boulder' | 'hut';
export const VEG_KINDS: VegKind[] = ['acacia', 'riparian', 'bush', 'boulder', 'hut'];

/** Valores por instancia: x, y, z, escala, rotación Y, aplastamiento vertical. */
export const INSTANCE_STRIDE = 6;

export interface Obstacle {
  x: number;
  y: number;
  z: number;
  radius: number;
  halfHeight: number;
  shape: 'cylinder' | 'ball';
}

export interface VegChunk {
  index: number;
  instances: Record<VegKind, number[]>;
  obstacles: Obstacle[];
}

const TREE_STEP = 9;
const BUSH_STEP = 6;

const cache = new WeakMap<WorldData, VegChunk[]>();

/** Distribución determinista de árboles, arbustos, rocas y chozas por chunk (cacheada por mundo). */
export function getVegetation(world: WorldData): VegChunk[] {
  let chunks = cache.get(world);
  if (!chunks) {
    chunks = generateVegetation(world);
    cache.set(world, chunks);
  }
  return chunks;
}

export function chunkIndexAt(world: WorldData, x: number, z: number): number {
  const cps = world.chunksPerSide;
  const cx = Math.min(cps - 1, Math.max(0, Math.floor((x + world.half) / world.chunkSize)));
  const cz = Math.min(cps - 1, Math.max(0, Math.floor((z + world.half) / world.chunkSize)));
  return cz * cps + cx;
}

function generateVegetation(world: WorldData): VegChunk[] {
  const cps = world.chunksPerSide;
  const size = world.chunkSize;
  const seed = world.config.seed;
  const clumpNoise = createNoise2D(seed + 777);
  const chunks: VegChunk[] = Array.from({ length: cps * cps }, (_, index) => ({
    index,
    instances: { acacia: [], riparian: [], bush: [], boulder: [], hut: [] },
    obstacles: [],
  }));

  const dry = (x: number, z: number) => world.waterLevelAt(x, z) === null;

  for (let cz = 0; cz < cps; cz++) {
    for (let cx = 0; cx < cps; cx++) {
      const chunk = chunks[cz * cps + cx];
      const rng = mulberry32(seed * 31 + chunk.index * 7919);
      const minX = -world.half + cx * size;
      const minZ = -world.half + cz * size;

      // Árboles: rejilla con jitter, densidad por bioma modulada por ruido (bosquetes).
      for (let gz = 0; gz < size; gz += TREE_STEP) {
        for (let gx = 0; gx < size; gx += TREE_STEP) {
          const x = minX + gx + rng() * TREE_STEP;
          const z = minZ + gz + rng() * TREE_STEP;
          const roll = rng();
          if (!world.inBounds(x, z, 6)) continue;
          const biome = world.biomeAt(x, z);
          const info = BIOMES[biome];
          const clump = clumpNoise(x / 90, z / 90) * 0.5 + 0.5;
          const p = info.treesPerHa * ((TREE_STEP * TREE_STEP) / 10000) * (0.3 + 1.4 * clump);
          if (roll >= p || !dry(x, z)) continue;
          const y = world.heightAt(x, z);
          const wet = biome === Biome.Riparian || biome === Biome.Swamp;
          const kind: VegKind = wet && rng() < 0.8 ? 'riparian' : 'acacia';
          const scale = kind === 'riparian' ? 0.8 + rng() * 0.5 : 0.7 + rng() * 0.6;
          chunk.instances[kind].push(x, y, z, scale, rng() * Math.PI * 2, 0.9 + rng() * 0.2);
          chunk.obstacles.push({
            x,
            y,
            z,
            radius: (kind === 'riparian' ? 0.48 : 0.32) * scale,
            halfHeight: 2,
            shape: 'cylinder',
          });
        }
      }

      // Arbustos: sin colisión (son cobertura, no obstáculo).
      for (let gz = 0; gz < size; gz += BUSH_STEP) {
        for (let gx = 0; gx < size; gx += BUSH_STEP) {
          const x = minX + gx + rng() * BUSH_STEP;
          const z = minZ + gz + rng() * BUSH_STEP;
          const roll = rng();
          if (!world.inBounds(x, z, 4)) continue;
          const info = BIOMES[world.biomeAt(x, z)];
          const clump = clumpNoise(x / 60 + 40, z / 60) * 0.5 + 0.5;
          const p = info.bushesPerHa * ((BUSH_STEP * BUSH_STEP) / 10000) * (0.3 + 1.4 * clump);
          if (roll >= p || !dry(x, z)) continue;
          chunk.instances.bush.push(x, world.heightAt(x, z) - 0.1, z, 0.6 + rng() * 0.9, rng() * Math.PI * 2, 0.8 + rng() * 0.4);
        }
      }
    }
  }

  // Cantos rodados de los kopjes: más grandes en el centro.
  const rng = mulberry32(seed + 1234);
  for (const k of world.features.kopjes) {
    const count = Math.round(k.radius * 0.85);
    for (let i = 0; i < count; i++) {
      const u = Math.sqrt(rng()) * 0.95;
      const a = rng() * Math.PI * 2;
      const x = k.x + Math.cos(a) * u * k.radius;
      const z = k.z + Math.sin(a) * u * k.radius;
      const s = (4.4 - 3.3 * u) * (0.6 + 0.6 * rng());
      const y = world.heightAt(x, z) - s * 0.28;
      const chunk = chunks[chunkIndexAt(world, x, z)];
      chunk.instances.boulder.push(x, y, z, s, rng() * Math.PI * 2, 0.7 + rng() * 0.5);
      chunk.obstacles.push({ x, y: y + s * 0.15, z, radius: s * 0.82, halfHeight: 0, shape: 'ball' });
    }
  }

  // Chozas de las aldeas (las aldeas cobrarán vida en la Fase 5).
  for (const v of world.features.villages) {
    const huts = 7 + Math.floor(rng() * 4);
    for (let i = 0; i < huts; i++) {
      const a = (i / huts) * Math.PI * 2 + rng() * 0.3;
      const r = 18 + rng() * 26;
      const x = v.x + Math.cos(a) * r;
      const z = v.z + Math.sin(a) * r;
      const y = world.heightAt(x, z) - 0.1;
      const s = 0.85 + rng() * 0.35;
      const chunk = chunks[chunkIndexAt(world, x, z)];
      chunk.instances.hut.push(x, y, z, s, rng() * Math.PI * 2, 1);
      chunk.obstacles.push({ x, y, z, radius: 2.4 * s, halfHeight: 1.6, shape: 'cylinder' });
    }
  }

  return chunks;
}
