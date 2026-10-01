import { generateWorld, type WorldArrays, type WorldConfig } from './worldgen';

export type WorldgenRequest = { type: 'generate'; config: WorldConfig };
export type WorldgenResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; arrays: WorldArrays };

const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<WorldgenRequest>) => {
  if (event.data.type !== 'generate') return;
  const arrays = generateWorld(event.data.config, (fraction) => {
    ctx.postMessage({ type: 'progress', fraction } satisfies WorldgenResponse);
  });
  ctx.postMessage({ type: 'done', arrays } satisfies WorldgenResponse, [
    arrays.heights.buffer,
    arrays.ground.buffer,
    arrays.biome.buffer,
  ]);
};
