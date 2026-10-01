/**
 * Pruebas del continente: regiones con fronteras cerradas y los siete jefes.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REGION_BOSSES } from '../src/ai/bossDefs';
import { bosses, updateBosses } from '../src/ai/bossEngine';
import { initMatriarch } from '../src/ai/matriarchBrain';
import { clock } from '../src/core/clock';
import { mulberry32 } from '../src/core/math';
import { useGame } from '../src/core/store';
import { player, resetNeeds, resetPlayer } from '../src/entities/player/playerState';
import { combat, damageFighter, resetCombat, updateCombat } from '../src/systems/combat';
import { dens, resetDens } from '../src/systems/dens';
import { defense, resetDefense, updateDefense } from '../src/systems/playerDefense';
import { progression, resetProgression } from '../src/systems/progression';
import { resetQuests } from '../src/systems/quests';
import { initRegions, isRegionOpen, regionAt, regions, updateRegions } from '../src/world/regions';
import { generateWorld, type WorldConfig } from '../src/world/worldgen';
import { WorldData } from '../src/world/WorldData';

const CONFIG: WorldConfig = { seed: 20260930, size: 4096, cells: 256, chunkCells: 64, waterLevel: 0, maxGrassHeight: 1.6 };
const DT = 1 / 30;
let world: WorldData;

beforeAll(() => {
  world = new WorldData(CONFIG, generateWorld(CONFIG));
});

beforeEach(() => {
  resetCombat();
  resetProgression();
  resetDefense();
  resetQuests();
  resetDens([{ id: 'natal', name: 'Guarida de la Acacia', x: 0, z: 0, claimed: true }]);
  initRegions(world, 0, 0);
  initMatriarch(world, 0, 0);
  resetPlayer(0, world.heightAt(0, 0), 0);
  resetNeeds();
  useGame.setState({ sex: 'male' });
  player.ageYears = 6;
});

describe('regiones', () => {
  it('hay seis regiones además de la sabana, sin solaparse', () => {
    const rs = regions.filter((r) => r.radius > 0);
    expect(rs.length).toBe(6);
    for (const a of rs) for (const b of rs) if (a !== b) expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z)).toBeGreaterThan(a.radius + b.radius - 1);
    for (const r of rs) expect(world.inBounds(r.center.x, r.center.z, 0)).toBe(true);
  });

  it('una región cerrada no deja entrar; al vencer al jefe se abre', () => {
    const delta = regions.find((r) => r.id === 'delta')!;
    expect(isRegionOpen(delta)).toBe(false);
    resetPlayer(delta.center.x, 0, delta.center.z);
    updateRegions(DT);
    expect(Math.hypot(player.position.x - delta.center.x, player.position.z - delta.center.z)).toBeGreaterThanOrEqual(delta.radius);
    progression.bossesDefeated.push('matriarch');
    resetPlayer(delta.center.x, 0, delta.center.z);
    updateRegions(DT);
    expect(regionAt(player.position.x, player.position.z).id).toBe('delta');
  });

  it('cada región tiene su guarida y su jefe', () => {
    for (const r of regions.filter((x) => x.radius > 0)) {
      expect(dens.some((d) => d.id === r.denId)).toBe(true);
      expect(bosses.some((b) => b.def.id === REGION_BOSSES[r.id].id)).toBe(true);
    }
  });
});

describe('jefes', () => {
  it('cada jefe se puede despertar, pasa a la fase II y deja su reliquia al caer', () => {
    const rng = mulberry32(4);
    for (const b of bosses) {
      resetCombat();
      resetDefense();
      if (b.def.nightOnly) clock.timeOfDay = 23;
      else clock.timeOfDay = 12;
      resetPlayer(b.arena.x + 4, b.arena.y, b.arena.z);
      player.needs.health = 1;
      updateBosses(world, DT);
      expect(b.state).toBe('fight');
      const f = combat.fighters.find((x) => x.agent === b.agent)!;
      damageFighter(f, 1.45, 0, rng, 'Prueba', true);
      updateBosses(world, DT);
      expect(b.phase).toBe(2);
      // Lucha un rato: los ataques deben resolverse sin errores.
      for (let i = 0; i < 30 * 6; i++) {
        defense.iframes = 1;
        updateCombat(world, DT, rng);
        updateBosses(world, DT);
        updateDefense(DT);
      }
      for (const e of combat.fighters) if (e.side === 'enemy' && e.agent) e.agent.health = 0;
      updateCombat(world, DT, rng);
      expect(b.state).toBe('defeated');
      if (b.def.relic) expect(progression.relics).toContain(b.def.relic);
    }
    expect(progression.bossesDefeated.length).toBe(7);
  });
});
