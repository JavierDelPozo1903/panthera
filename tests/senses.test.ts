/**
 * Pruebas del modo sensorial: se activa agachado, deja rastros de olor que derivan con el
 * viento y ondas de sonido de los animales que corren; se apaga al levantarse o pelear.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearBosses } from '../src/ai/bossEngine';
import { createAgent, hyenas, type HyenaAgent } from '../src/entities/npc/npcState';
import { player, resetPlayer } from '../src/entities/player/playerState';
import { combat, resetCombat } from '../src/systems/combat';
import { pings, puffs, resetSenses, senses, updateSenses } from '../src/systems/senses';
import { wind } from '../src/systems/wind';

const DT = 1 / 30;

function run(seconds: number): void {
  for (let t = 0; t < seconds; t += DT) updateSenses(DT);
}

function addHyena(x: number, z: number, speed: number): HyenaAgent {
  const h: HyenaAgent = { ...createAgent('h-test', 'Hiena', 'female', 4, 'roam'), targetId: null, lostTime: 0, biteCooldown: 0, seed: 1 };
  h.position.set(x, 0, z);
  h.speed = speed;
  hyenas.push(h);
  return h;
}

beforeEach(() => {
  hyenas.length = 0;
  clearBosses();
  resetCombat();
  resetSenses();
  resetPlayer(0, 0, 0);
  player.alive = true;
  player.crouching = false;
});

describe('modo sensorial', () => {
  it('solo se enciende tras un instante agachado', () => {
    addHyena(30, 0, 0);
    run(1);
    expect(senses.level).toBe(0);
    player.crouching = true;
    run(0.4);
    expect(senses.level).toBe(0);
    run(2.5);
    expect(senses.level).toBeGreaterThan(0.9);
    expect(puffs.some((p) => p.kind === 'hyena')).toBe(true);
  });

  it('el olor deriva a favor del viento', () => {
    addHyena(30, 0, 0);
    player.crouching = true;
    run(1.2);
    const p = puffs[0];
    const x0 = p.x;
    const z0 = p.z;
    run(2);
    const moved = (p.x - x0) * wind.dir.x + (p.z - z0) * wind.dir.y;
    expect(moved).toBeGreaterThan(0.5);
  });

  it('los que corren emiten ondas; los lejanos no huelen', () => {
    addHyena(40, 0, 9);
    addHyena(400, 0, 9);
    player.crouching = true;
    run(3);
    expect(pings.length).toBeGreaterThan(0);
    expect(puffs.every((p) => Math.hypot(p.x, p.z) < 200)).toBe(true);
  });

  it('se apaga al levantarse o al empezar una pelea', () => {
    player.crouching = true;
    run(3);
    combat.active = true;
    run(1.5);
    expect(senses.level).toBeLessThan(0.05);
    combat.active = false;
  });
});
