/**
 * Generación procedural del mundo (función pura, sin three.js: corre en un Web Worker).
 *
 * Produce tres mapas regulares de (cells+1)² muestras:
 *  - heights: altura del terreno en metros
 *  - ground:  RGBA8 → RGB = albedo del suelo (sRGB), A = altura de la hierba normalizada
 *  - biome:   id de bioma por muestra
 */
import { clamp, lerp, mulberry32, smoothstep } from '../core/math';
import { BIOMES, Biome, GROUND_COLORS, type BiomeId } from './biomes';
import { createNoise2D, fbm, ridged } from './noise';

export interface WorldConfig {
  seed: number;
  /** Lado del mapa en metros. */
  size: number;
  /** Celdas por lado (las muestras son cells + 1). */
  cells: number;
  chunkCells: number;
  waterLevel: number;
  maxGrassHeight: number;
}

export interface Waterhole {
  x: number;
  z: number;
  radius: number;
  /** Cota de la lámina de agua. */
  level: number;
}
export interface Kopje {
  x: number;
  z: number;
  radius: number;
  height: number;
}
export interface Village {
  x: number;
  z: number;
  radius: number;
  level: number;
}
export interface Swamp {
  x: number;
  z: number;
  radius: number;
}

export interface WorldFeatures {
  waterholes: Waterhole[];
  kopjes: Kopje[];
  villages: Village[];
  swamp: Swamp;
  spawn: { x: number; z: number };
}

export interface WorldArrays {
  heights: Float32Array<ArrayBuffer>;
  ground: Uint8Array<ArrayBuffer>;
  biome: Uint8Array<ArrayBuffer>;
  features: WorldFeatures;
}

const RIVER_OFFSET_X = 420;

/** Eje del río: recorre el mapa de norte a sur con meandros. */
export function riverCenterX(z: number): number {
  return (
    RIVER_OFFSET_X +
    260 * Math.sin(z * 0.0021 + 0.7) +
    140 * Math.sin(z * 0.0045 + 2.1) +
    40 * Math.sin(z * 0.011)
  );
}

function riverSlope(z: number): number {
  return (
    260 * 0.0021 * Math.cos(z * 0.0021 + 0.7) +
    140 * 0.0045 * Math.cos(z * 0.0045 + 2.1) +
    40 * 0.011 * Math.cos(z * 0.011)
  );
}

/** Distancia perpendicular aproximada al eje del río. */
export function riverDistance(x: number, z: number): number {
  const slope = riverSlope(z);
  return Math.abs(x - riverCenterX(z)) / Math.sqrt(1 + slope * slope);
}

const mix3 = (out: number[], c: readonly number[], t: number): void => {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
};

export function generateWorld(
  cfg: WorldConfig,
  onProgress?: (fraction: number) => void,
): WorldArrays {
  const { seed, size, cells, waterLevel } = cfg;
  const half = size / 2;
  const cellSize = size / cells;
  const n = cells + 1;

  const nBase = createNoise2D(seed);
  const nDetail = createNoise2D(seed + 101);
  const nMicro = createNoise2D(seed + 202);
  const nRock = createNoise2D(seed + 303);
  const nMoist = createNoise2D(seed + 404);
  const nColor = createNoise2D(seed + 505);
  const rng = mulberry32(seed + 606);

  /** Relieve suave de sabana antes de tallar ríos y pozas. */
  const baseHeight = (x: number, z: number): number => {
    const e = fbm(nBase, x / 1600, z / 1600, 5);
    const hills = Math.pow(clamp(e * 0.5 + 0.5, 0, 1), 1.25);
    return 7 + hills * 40 + fbm(nDetail, x / 140, z / 140, 3) * 2.2;
  };

  // --- Colocación de elementos singulares -------------------------------------------------
  const swamp: Swamp = { x: riverCenterX(-1150) + 110, z: -1150, radius: 390 };

  const placeSites = (
    count: number,
    range: number,
    minSeparation: number,
    accept: (x: number, z: number) => boolean,
  ): { x: number; z: number }[] => {
    const sites: { x: number; z: number }[] = [];
    for (let tries = 0; tries < 4000 && sites.length < count; tries++) {
      const x = (rng() * 2 - 1) * range;
      const z = (rng() * 2 - 1) * range;
      if (!accept(x, z)) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < minSeparation)) continue;
      sites.push({ x, z });
    }
    return sites;
  };

  const farFromSwamp = (x: number, z: number, margin: number): boolean =>
    Math.hypot(x - swamp.x, z - swamp.z) > swamp.radius + margin;

  const kopjes: Kopje[] = placeSites(
    7,
    1650,
    520,
    (x, z) => riverDistance(x, z) > 330 && farFromSwamp(x, z, 150) && Math.hypot(x, z) > 260,
  ).map((s) => ({ ...s, radius: 55 + rng() * 60, height: 14 + rng() * 22 }));

  const waterholes: Waterhole[] = placeSites(
    6,
    1600,
    560,
    (x, z) =>
      riverDistance(x, z) > 520 &&
      farFromSwamp(x, z, 250) &&
      kopjes.every((k) => Math.hypot(k.x - x, k.z - z) > k.radius + 170),
  ).map((s) => ({ ...s, radius: 17 + rng() * 14, level: baseHeight(s.x, s.z) - 1.1 }));

  // Aldeas humanas en los bordes del mapa.
  const villageAnchors: [number, number][] = [
    [-1760, -820],
    [1740, 1180],
    [-640, 1790],
    [1760, -1300],
    [-1780, 760],
  ];
  const villages: Village[] = [];
  for (const [ax, az] of villageAnchors) {
    if (villages.length >= 3) break;
    const x = ax + (rng() - 0.5) * 120;
    const z = az + (rng() - 0.5) * 120;
    const clear =
      riverDistance(x, z) > 330 &&
      farFromSwamp(x, z, 200) &&
      kopjes.every((k) => Math.hypot(k.x - x, k.z - z) > k.radius + 180) &&
      waterholes.every((w) => Math.hypot(w.x - x, w.z - z) > 220);
    if (clear) villages.push({ x, z, radius: 95, level: baseHeight(x, z) });
  }

  // --- Muestreo del mapa ------------------------------------------------------------------
  const heights = new Float32Array(n * n);
  const ground = new Uint8Array(n * n * 4);
  const biome = new Uint8Array(n * n);
  const col = [0, 0, 0];

  const bGrass = BIOMES[Biome.Grassland];
  const bWood = BIOMES[Biome.Woodland];
  const bRip = BIOMES[Biome.Riparian];
  const bKopje = BIOMES[Biome.Kopje];
  const bSwamp = BIOMES[Biome.Swamp];
  const bVillage = BIOMES[Biome.Village];

  for (let iz = 0; iz < n; iz++) {
    const z = -half + iz * cellSize;
    const riverX = riverCenterX(z);
    const slopeNorm = 1 / Math.sqrt(1 + riverSlope(z) ** 2);
    const halfWidth = 12 + 5 * nMicro(z / 230, 7.7);
    const bedDepth = -2.0 - 1.6 * Math.max(0, nMicro(z / 310, 91.3));

    for (let ix = 0; ix < n; ix++) {
      const x = -half + ix * cellSize;
      const i = iz * n + ix;

      let h = baseHeight(x, z) + nMicro(x / 13, z / 13) * 0.25;

      // Río: llanura de inundación y cauce.
      const dRiver = Math.abs(x - riverX) * slopeNorm;
      const flood = smoothstep(25, 430, dRiver);
      h = lerp(1.5 + nDetail(x / 55, z / 55) * 0.5, h, flood);
      const bank = smoothstep(halfWidth * 0.3, halfWidth + 11, dRiver);
      h = lerp(bedDepth, h, bank);

      // Pantano: terreno casi a cota de agua, con charcas someras.
      const swampMask = 1 - smoothstep(0.5, 1, Math.hypot(x - swamp.x, z - swamp.z) / swamp.radius);
      if (swampMask > 0) {
        const marsh = -0.1 + nDetail(x / 16, z / 16) * 0.45 + nMicro(x / 70, z / 70) * 0.3;
        h = lerp(h, marsh, swampMask * bank);
      }

      // Kopjes: afloramientos rocosos.
      let kopjeMask = 0;
      for (const k of kopjes) {
        const u = Math.hypot(x - k.x, z - k.z) / k.radius;
        if (u >= 1) continue;
        const m = 1 - u * u;
        h += k.height * Math.pow(m, 1.4) * (0.55 + 0.45 * ridged(nRock, x / 38, z / 38, 3));
        if (m > kopjeMask) kopjeMask = m;
      }

      // Aldeas: explanadas de tierra.
      let villageMask = 0;
      for (const v of villages) {
        const u = Math.hypot(x - v.x, z - v.z) / v.radius;
        if (u >= 1.4) continue;
        h = lerp(h, v.level, 1 - smoothstep(0.55, 1.4, u));
        villageMask = Math.max(villageMask, 1 - smoothstep(0.5, 1.0, u));
      }

      // Pozas: cuencos con su propia lámina de agua.
      let localWater = waterLevel;
      let inWaterholeBasin = false;
      let waterholeRing = 0;
      for (const w of waterholes) {
        const u = Math.hypot(x - w.x, z - w.z) / w.radius;
        if (u >= 3.6) continue;
        const bowl = w.level - 1.9 * (1 - smoothstep(0, 1, u)) + 0.6 * smoothstep(1, 3, u);
        h = lerp(h, bowl, 1 - smoothstep(1.6, 3.6, u));
        if (u < 2.4) {
          localWater = w.level;
          inWaterholeBasin = true;
        }
        waterholeRing = Math.max(waterholeRing, (1 - smoothstep(1.3, 2.9, u)) * 0.8);
      }

      heights[i] = h;

      // --- Pesos de bioma ---
      const moisture = fbm(nMoist, x / 850, z / 850, 3);
      const woodW = smoothstep(0.02, 0.38, moisture);
      const ripW = Math.max(1 - smoothstep(35, 150, dRiver), waterholeRing);
      const rockW = smoothstep(0.1, 0.4, kopjeMask);
      const nearWater = ripW > 0.05 || swampMask > 0.05 || inWaterholeBasin;
      const aboveWater = h - localWater;
      const shoreW = nearWater ? 1 - smoothstep(0.12, 0.95, aboveWater) : 0;
      const underwater = nearWater && aboveWater < 0;

      const variation = nColor(x / 45, z / 45) * 0.5 + 0.5;
      const bareW =
        smoothstep(0.45, 0.72, nColor(x / 28 + 50, z / 28 - 50)) * (1 - woodW) * (1 - ripW) * 0.6;

      // Color del suelo
      col[0] = bGrass.color[0];
      col[1] = bGrass.color[1];
      col[2] = bGrass.color[2];
      mix3(col, bWood.color, woodW);
      mix3(col, GROUND_COLORS.bareEarth, bareW);
      mix3(col, bRip.color, ripW);
      mix3(col, bSwamp.color, swampMask);
      mix3(col, bKopje.color, rockW);
      mix3(col, bVillage.color, villageMask);
      mix3(col, GROUND_COLORS.mud, shoreW);
      if (underwater) mix3(col, GROUND_COLORS.riverBed, smoothstep(0, 0.8, -aboveWater));
      const shade = 0.86 + 0.26 * variation;

      // Altura de la hierba
      let gh = bGrass.grassHeight * (0.72 + 0.5 * variation);
      gh = lerp(gh, bWood.grassHeight * (0.7 + 0.5 * variation), woodW);
      gh = lerp(gh, 0.22, bareW);
      gh = lerp(gh, bRip.grassHeight, ripW);
      gh = lerp(gh, bSwamp.grassHeight * (0.8 + 0.3 * variation), swampMask);
      gh = lerp(gh, bKopje.grassHeight, rockW);
      gh = lerp(gh, bVillage.grassHeight, villageMask);
      // En el pantano los carrizos crecen dentro del agua somera; en río y pozas, no.
      const reeds = swampMask > 0.3 && aboveWater > -0.35;
      if (!reeds) gh = lerp(gh, 0.12, shoreW);
      if (underwater && !reeds) gh = 0;

      const g = i * 4;
      ground[g] = clamp(col[0] * shade, 0, 1) * 255;
      ground[g + 1] = clamp(col[1] * shade, 0, 1) * 255;
      ground[g + 2] = clamp(col[2] * shade, 0, 1) * 255;
      ground[g + 3] = clamp(gh / cfg.maxGrassHeight, 0, 1) * 255;

      let id: BiomeId;
      if (underwater) {
        id = inWaterholeBasin ? Biome.Waterhole : swampMask > 0.5 ? Biome.Swamp : Biome.River;
      } else if (villageMask > 0.5) id = Biome.Village;
      else if (rockW > 0.5) id = Biome.Kopje;
      else if (swampMask > 0.5) id = Biome.Swamp;
      else if (ripW > 0.5) id = Biome.Riparian;
      else if (woodW > 0.5) id = Biome.Woodland;
      else id = Biome.Grassland;
      biome[i] = id;
    }

    if (onProgress && (iz & 31) === 0) onProgress(iz / n);
  }

  // --- Punto de aparición: pradera abierta cerca del centro ------------------------------
  let spawn = { x: -120, z: 90 };
  search: for (let ring = 0; ring < 60; ring++) {
    const r = ring * 24;
    const steps = Math.max(1, Math.floor((Math.PI * 2 * r) / 24));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const x = -120 + Math.cos(a) * r;
      const z = 90 + Math.sin(a) * r;
      const ix = Math.round((x + half) / cellSize);
      const iz = Math.round((z + half) / cellSize);
      if (ix < 8 || iz < 8 || ix > cells - 8 || iz > cells - 8) continue;
      const i = iz * n + ix;
      if (biome[i] === Biome.Grassland && ground[i * 4 + 3] > 130) {
        spawn = { x, z };
        break search;
      }
    }
  }

  onProgress?.(1);
  return { heights, ground, biome, features: { waterholes, kopjes, villages, swamp, spawn } };
}
