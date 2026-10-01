import * as THREE from 'three';
import { clamp } from '../core/math';
import type { BiomeId } from './biomes';
import type { WorldArrays, WorldConfig, WorldFeatures } from './worldgen';

/**
 * Fuente única de verdad del terreno en el hilo principal.
 * Envuelve los mapas generados por el worker y ofrece muestreo rápido (CPU) y texturas (GPU).
 */
export class WorldData {
  readonly config: WorldConfig;
  readonly size: number;
  readonly half: number;
  readonly cells: number;
  readonly samples: number;
  readonly cellSize: number;
  readonly chunkCells: number;
  readonly chunksPerSide: number;
  readonly chunkSize: number;
  readonly waterLevel: number;
  readonly maxGrassHeight: number;

  readonly heights: Float32Array<ArrayBuffer>;
  readonly ground: Uint8Array<ArrayBuffer>;
  readonly biome: Uint8Array<ArrayBuffer>;
  readonly features: WorldFeatures;

  /** R32F con la altura en metros (filtrado manual en shader). */
  readonly heightTexture: THREE.DataTexture;
  /** RGBA8 sRGB: albedo del suelo + altura de hierba en alfa. */
  readonly groundTexture: THREE.DataTexture;

  /** Uniforms compartidos por los shaders que muestrean el terreno. */
  readonly uniforms: {
    uHeightMap: THREE.IUniform<THREE.DataTexture>;
    uGroundMap: THREE.IUniform<THREE.DataTexture>;
    uWorldHalf: THREE.IUniform<number>;
    uCellSize: THREE.IUniform<number>;
    uCells: THREE.IUniform<number>;
    uMaxGrassHeight: THREE.IUniform<number>;
  };

  constructor(config: WorldConfig, arrays: WorldArrays) {
    this.config = config;
    this.size = config.size;
    this.half = config.size / 2;
    this.cells = config.cells;
    this.samples = config.cells + 1;
    this.cellSize = config.size / config.cells;
    this.chunkCells = config.chunkCells;
    this.chunksPerSide = config.cells / config.chunkCells;
    this.chunkSize = this.chunkCells * this.cellSize;
    this.waterLevel = config.waterLevel;
    this.maxGrassHeight = config.maxGrassHeight;

    this.heights = arrays.heights;
    this.ground = arrays.ground;
    this.biome = arrays.biome;
    this.features = arrays.features;

    const n = this.samples;
    this.heightTexture = new THREE.DataTexture(
      this.heights,
      n,
      n,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.heightTexture.minFilter = THREE.NearestFilter;
    this.heightTexture.magFilter = THREE.NearestFilter;
    this.heightTexture.needsUpdate = true;

    this.groundTexture = new THREE.DataTexture(
      this.ground,
      n,
      n,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.groundTexture.minFilter = THREE.LinearFilter;
    this.groundTexture.magFilter = THREE.LinearFilter;
    this.groundTexture.needsUpdate = true;

    this.uniforms = {
      uHeightMap: { value: this.heightTexture },
      uGroundMap: { value: this.groundTexture },
      uWorldHalf: { value: this.half },
      uCellSize: { value: this.cellSize },
      uCells: { value: this.cells },
      uMaxGrassHeight: { value: this.maxGrassHeight },
    };
  }

  /**
   * Altura del terreno. Interpola sobre los mismos dos triángulos por celda que usa la malla
   * de máximo detalle, así las patas del león pisan exactamente la superficie dibujada.
   */
  heightAt(x: number, z: number): number {
    const max = this.cells - 1e-4;
    const fx = clamp((x + this.half) / this.cellSize, 0, max);
    const fz = clamp((z + this.half) / this.cellSize, 0, max);
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const n = this.samples;
    const i = iz * n + ix;
    const H = this.heights;
    const a = H[i];
    const b = H[i + 1];
    const c = H[i + n];
    const d = H[i + n + 1];
    return tx + tz <= 1
      ? a + (b - a) * tx + (c - a) * tz
      : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  /** Altura en un nodo de la rejilla (índices enteros, con límites). */
  gridHeight(ix: number, iz: number): number {
    const n = this.samples;
    const cx = ix < 0 ? 0 : ix >= n ? n - 1 : ix;
    const cz = iz < 0 ? 0 : iz >= n ? n - 1 : iz;
    return this.heights[cz * n + cx];
  }

  /** Normal del terreno por diferencias centrales. */
  normalAt(x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
    const e = this.cellSize;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return target.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  private nearestIndex(x: number, z: number): number {
    const ix = clamp(Math.round((x + this.half) / this.cellSize), 0, this.cells);
    const iz = clamp(Math.round((z + this.half) / this.cellSize), 0, this.cells);
    return iz * this.samples + ix;
  }

  biomeAt(x: number, z: number): BiomeId {
    return this.biome[this.nearestIndex(x, z)] as BiomeId;
  }

  /** Altura de la hierba en metros (cobertura disponible para el acecho). */
  grassHeightAt(x: number, z: number): number {
    return (this.ground[this.nearestIndex(x, z) * 4 + 3] / 255) * this.maxGrassHeight;
  }

  /**
   * Cota de la lámina de agua que cubre este punto, o null si está en seco.
   * El río y el pantano comparten el nivel global; cada poza tiene el suyo.
   */
  waterLevelAt(x: number, z: number): number | null {
    const h = this.heightAt(x, z);
    if (h < this.waterLevel) return this.waterLevel;
    for (const w of this.features.waterholes) {
      const dx = x - w.x;
      const dz = z - w.z;
      if (dx * dx + dz * dz < (w.radius * 2.4) ** 2 && h < w.level) return w.level;
    }
    return null;
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    const lim = this.half - margin;
    return x > -lim && x < lim && z > -lim && z < lim;
  }

  dispose(): void {
    this.heightTexture.dispose();
    this.groundTexture.dispose();
  }
}

/** Fragmento GLSL común: altura del terreno con la misma triangulación que `heightAt`. */
export const TERRAIN_GLSL = /* glsl */ `
uniform sampler2D uHeightMap;
uniform sampler2D uGroundMap;
uniform float uWorldHalf;
uniform float uCellSize;
uniform float uCells;
uniform float uMaxGrassHeight;

float terrainHeight(vec2 wp) {
  vec2 f = clamp((wp + uWorldHalf) / uCellSize, vec2(0.0), vec2(uCells - 0.001));
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  float a = texelFetch(uHeightMap, i, 0).r;
  float b = texelFetch(uHeightMap, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeightMap, i + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeightMap, i + ivec2(1, 1), 0).r;
  return (t.x + t.y <= 1.0)
    ? a + (b - a) * t.x + (c - a) * t.y
    : d + (c - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
}

vec4 terrainGround(vec2 wp) {
  vec2 f = clamp((wp + uWorldHalf) / uCellSize, vec2(0.0), vec2(uCells));
  return texture2D(uGroundMap, (f + 0.5) / (uCells + 1.0));
}
`;
