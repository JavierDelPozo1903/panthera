import worldConfig from '../data/world.json';
import type { WorldConfig } from './worldgen';
import type { WorldgenRequest, WorldgenResponse } from './worldgen.worker';
import { WorldData } from './WorldData';

export const WORLD_CONFIG: WorldConfig = {
  seed: worldConfig.seed,
  size: worldConfig.sizeMeters,
  cells: worldConfig.cells,
  chunkCells: worldConfig.chunkCells,
  waterLevel: worldConfig.waterLevel,
  maxGrassHeight: worldConfig.maxGrassHeight,
};

/** Genera el mundo en un Web Worker para no bloquear la interfaz durante la carga. */
export function generateWorldAsync(onProgress: (fraction: number) => void): Promise<WorldData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorldgenResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgress(msg.fraction);
      } else {
        resolve(new WorldData(WORLD_CONFIG, msg.arrays));
        worker.terminate();
      }
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(error);
    };
    worker.postMessage({ type: 'generate', config: WORLD_CONFIG } satisfies WorldgenRequest);
  });
}
