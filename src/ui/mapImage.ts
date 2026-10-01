import { Biome } from '../world/biomes';
import type { WorldData } from '../world/WorldData';

const PAPER = [0.93, 0.87, 0.74];
const WATER_SHALLOW = [0.42, 0.56, 0.56];
const WATER_DEEP = [0.22, 0.36, 0.4];
const CONTOUR_METERS = 8;

const cache = new WeakMap<WorldData, HTMLCanvasElement>();

/** Mapa base cacheado por mundo (lo comparten minimapa y mapa completo). */
export function getWorldMapImage(world: WorldData): HTMLCanvasElement {
  let img = cache.get(world);
  if (!img) {
    img = renderWorldMap(world, 1024);
    cache.set(world, img);
  }
  return img;
}

/**
 * Pinta el mapa base del territorio con estilo de cuaderno de campo: relieve sombreado,
 * curvas de nivel, agua y tono de papel. Norte (−Z) arriba, este (+X) a la derecha.
 */
export function renderWorldMap(world: WorldData, size = 1024): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const n = world.samples;
  const cs = world.cellSize;
  // Luz rasante del noroeste, clásica en cartografía.
  const lx = -0.55;
  const ly = 0.62;
  const lz = -0.55;

  for (let py = 0; py < size; py++) {
    const gz = Math.round((py / (size - 1)) * world.cells);
    for (let px = 0; px < size; px++) {
      const gx = Math.round((px / (size - 1)) * world.cells);
      const i = gz * n + gx;
      const h = world.heights[i];
      const biome = world.biome[i];

      let r: number;
      let g: number;
      let b: number;
      if (biome === Biome.River || biome === Biome.Waterhole || (biome === Biome.Swamp && h < world.waterLevel)) {
        const depth = biome === Biome.Waterhole ? 1 : Math.min(1, -h / 2.5);
        r = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * depth;
        g = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * depth;
        b = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * depth;
      } else {
        const dx = world.gridHeight(gx + 1, gz) - world.gridHeight(gx - 1, gz);
        const dz = world.gridHeight(gx, gz + 1) - world.gridHeight(gx, gz - 1);
        const nx = -dx;
        const ny = 2 * cs;
        const nz = -dz;
        const inv = 1 / Math.hypot(nx, ny, nz);
        const shade = 0.62 + 0.55 * Math.max(0, (nx * lx + ny * ly + nz * lz) * inv);
        r = (world.ground[i * 4] / 255) * shade;
        g = (world.ground[i * 4 + 1] / 255) * shade;
        b = (world.ground[i * 4 + 2] / 255) * shade;
        // Curvas de nivel.
        const hn = world.gridHeight(gx + 1, gz + 1);
        if (Math.floor(h / CONTOUR_METERS) !== Math.floor(hn / CONTOUR_METERS)) {
          r *= 0.78;
          g *= 0.74;
          b *= 0.7;
        }
      }
      // Tono de papel envejecido.
      r = r * 0.72 + PAPER[0] * 0.28;
      g = g * 0.72 + PAPER[1] * 0.28;
      b = b * 0.72 + PAPER[2] * 0.28;

      const o = (py * size + px) * 4;
      data[o] = Math.min(255, r * 255);
      data[o + 1] = Math.min(255, g * 255);
      data[o + 2] = Math.min(255, b * 255);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
