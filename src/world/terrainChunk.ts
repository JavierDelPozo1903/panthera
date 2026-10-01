import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { WorldData } from './WorldData';

/** LOD 0..3 → paso de muestreo de la rejilla (1, 2, 4, 8 celdas). */
export const LOD_STEPS = [1, 2, 4, 8] as const;

/** Tabla sRGB → lineal para convertir el albedo del mapa a colores de vértice. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Escala del UV mundial para la textura de detalle (metros por repetición). */
const DETAIL_METERS = 7;

/**
 * Construye la geometría de un chunk con el LOD indicado.
 * Incluye un "faldón" perimetral hundido que tapa las grietas entre chunks de distinto LOD.
 * Las normales salen siempre de la rejilla completa, así la iluminación no salta entre LODs.
 */
export function buildChunkGeometry(
  world: WorldData,
  cx: number,
  cz: number,
  lod: number,
): THREE.BufferGeometry {
  const step = LOD_STEPS[lod];
  const segs = world.chunkCells / step;
  const side = segs + 3; // +1 vértice por lado para cerrar y +2 para el faldón
  const vertexCount = side * side;
  const skirtDepth = 1.5 + step * 1.5;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const n = world.samples;
  const cs = world.cellSize;
  const H = world.heights;
  const G = world.ground;
  const baseX = cx * world.chunkCells;
  const baseZ = cz * world.chunkCells;

  let v = 0;
  for (let j = -1; j <= segs + 1; j++) {
    const cj = j < 0 ? 0 : j > segs ? segs : j;
    for (let i = -1; i <= segs + 1; i++) {
      const ci = i < 0 ? 0 : i > segs ? segs : i;
      const gx = baseX + ci * step;
      const gz = baseZ + cj * step;
      const idx = gz * n + gx;
      const skirt = i !== ci || j !== cj;

      const x = -world.half + gx * cs;
      const z = -world.half + gz * cs;
      positions[v * 3] = x;
      positions[v * 3 + 1] = H[idx] - (skirt ? skirtDepth : 0);
      positions[v * 3 + 2] = z;

      const hl = world.gridHeight(gx - 1, gz);
      const hr = world.gridHeight(gx + 1, gz);
      const hd = world.gridHeight(gx, gz - 1);
      const hu = world.gridHeight(gx, gz + 1);
      let nx = hl - hr;
      let ny = 2 * cs;
      let nz = hd - hu;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;

      colors[v * 3] = SRGB_TO_LINEAR[G[idx * 4]];
      colors[v * 3 + 1] = SRGB_TO_LINEAR[G[idx * 4 + 1]];
      colors[v * 3 + 2] = SRGB_TO_LINEAR[G[idx * 4 + 2]];

      uvs[v * 2] = x / DETAIL_METERS;
      uvs[v * 2 + 1] = z / DETAIL_METERS;
      v++;
    }
  }

  // Dos triángulos por celda con diagonal b–c (la misma que asume WorldData.heightAt).
  const quads = side - 1;
  const indices = new Uint16Array(quads * quads * 6);
  let k = 0;
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Textura de detalle en escala de grises, repetible (ruido de valor periódico + grano).
 * Multiplica el albedo del terreno para dar textura de tierra y hierba seca de cerca.
 */
export function createDetailTexture(size = 256): THREE.DataTexture {
  const rng = mulberry32(4242);
  const data = new Uint8Array(size * size * 4);
  const octaves = [
    { period: 8, amp: 0.45 },
    { period: 16, amp: 0.25 },
    { period: 32, amp: 0.15 },
    { period: 64, amp: 0.1 },
  ];
  const lattices = octaves.map((o) => {
    const l = new Float32Array(o.period * o.period);
    for (let i = 0; i < l.length; i++) l[i] = rng();
    return l;
  });
  const smooth = (t: number) => t * t * (3 - 2 * t);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      octaves.forEach((o, oi) => {
        const fx = (x / size) * o.period;
        const fy = (y / size) * o.period;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const p = o.period;
        const L = lattices[oi];
        const v00 = L[(y0 % p) * p + (x0 % p)];
        const v10 = L[(y0 % p) * p + ((x0 + 1) % p)];
        const v01 = L[((y0 + 1) % p) * p + (x0 % p)];
        const v11 = L[((y0 + 1) % p) * p + ((x0 + 1) % p)];
        value += o.amp * (v00 + (v10 - v00) * tx + (v01 - v00) * ty + (v00 - v10 - v01 + v11) * tx * ty);
      });
      const grain = (rng() - 0.5) * 0.22;
      const c = Math.max(0, Math.min(1, 0.66 + (value - 0.5) * 0.55 + grain));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = c * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
