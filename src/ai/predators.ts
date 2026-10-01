import { hyenas, mother, pride, type Agent } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { saturate } from '../core/math';
import { visibility } from '../systems/stealth';
import type { WorldData } from '../world/WorldData';

export interface PredatorView {
  id: string;
  x: number;
  z: number;
  speed: number;
  /** Visibilidad [0, 1] para una presa. */
  visibility: number;
  isLion: boolean;
}

const LOW_CLIPS = new Set(['stalkIdle', 'stalkWalk', 'rest', 'eat']);

function lionView(agent: Agent, world: WorldData, bodyHeight: number): PredatorView {
  const low = LOW_CLIPS.has(agent.clip);
  const cover = saturate(world.grassHeightAt(agent.position.x, agent.position.z) / (bodyHeight * (low ? 0.6 : 1)));
  return {
    id: agent.id,
    x: agent.position.x,
    z: agent.position.z,
    speed: agent.speed,
    visibility: visibility({ cover, lowPosture: low, speed: agent.speed, small: false }),
    isLion: true,
  };
}

/** Depredadores que las presas pueden detectar este frame. */
export function predatorViews(world: WorldData): PredatorView[] {
  const list: PredatorView[] = [];
  if (player.alive) {
    list.push({
      id: 'player',
      x: player.position.x,
      z: player.position.z,
      speed: player.speed,
      visibility: player.visibility,
      isLion: true,
    });
  }
  if (mother.active && mother.alive && mother.state !== 'away') list.push(lionView(mother, world, 1.05));
  for (const p of pride) if (p.alive) list.push(lionView(p, world, p.role === 'father' ? 1.2 : 1.05));
  for (const h of hyenas) {
    if (!h.alive) continue;
    list.push({ id: h.id, x: h.position.x, z: h.position.z, speed: h.speed, visibility: 0.8, isLion: false });
  }
  return list;
}
