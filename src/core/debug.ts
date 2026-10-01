import { director } from '../ai/director';
import { spawnClan } from '../ai/hyenaBrain';
import { startHunt, startRelocation } from '../ai/motherBrain';
import { groupHunt, startGroupHunt } from '../ai/huntBrain';
import { herds } from '../entities/prey/preyState';
import { takedown } from '../systems/takedown';
import { skipToNextStage } from '../systems/aging';
import { carcasses } from '../entities/carcass/carcassState';
import { hyenas, mother, siblings } from '../entities/npc/npcState';
import { cameraState } from '../entities/player/CameraRig';
import { player } from '../entities/player/playerState';
import { journal, recordMilestone } from '../systems/journal';
import { audio } from './audio/audioEngine';
import { clock } from './clock';
import { useGame } from './store';
import { setAge } from '../systems/aging';
import { combat, startCombat } from '../systems/combat';
import { randomTraits } from '../systems/genetics';
import { playerRepro } from '../systems/reproduction';
import { playerBody } from '../systems/wounds';
import { createWildLion, wildLions } from '../entities/npc/wildLions';
import { territories } from '../world/territories';
import { matriarch } from '../ai/matriarchBrain';
import { progression } from '../systems/progression';

/**
 * Consola de depuración (solo en desarrollo): `window.__panthera` permite inspeccionar
 * y provocar eventos desde las herramientas del navegador.
 */
export function installDebugHooks(get: unknown): void {
  if (!import.meta.env.DEV) return;
  const world = () => useGame.getState().world!;
  (window as unknown as Record<string, unknown>).__panthera = {
    get,
    player,
    mother,
    siblings,
    hyenas,
    carcasses,
    clock,
    journal,
    director,
    useGame,
    cameraState,
    audio,
    herds,
    groupHunt,
    takedown,
    skipStage: skipToNextStage,
    groupHuntNearest: () => {
      const h = [...herds].filter((x) => x.size > 0).sort((a, b) => a.center.distanceTo(player.position) - b.center.distanceTo(player.position))[0];
      if (h) startGroupHunt(h);
      return h?.species;
    },
    milestone: recordMilestone,
    startHunt: () => startHunt(world(), Math.random),
    relocate: (x: number, z: number) => startRelocation(mother.position.clone().set(x, 0, z)),
    wildLions,
    territories,
    matriarch,
    progression,
    /** Lleva al jugador al claro de La Matriarca. */
    toBoss: () => {
      const a = matriarch.arena;
      player.position.set(a.x + 12, world().heightAt(a.x + 12, a.z), a.z);
    },
    combat,
    playerBody,
    playerRepro,
    setAge: (years: number) => setAge(years, true),
    /** Hace aparecer un macho nómada a tu lado y empieza una pelea. */
    fight: (age = 4) => {
      const x = player.position.x + 3;
      const z = player.position.z;
      const rival = createWildLion('nomad', 'Rival', 'male', age, randomTraits(Math.random), x, world().heightAt(x, z), z);
      wildLions.push(rival);
      startCombat([rival], 'nomad', null);
      return rival;
    },
    hyenas3: () => spawnClan(world(), player.position.x, player.position.z, 3, Math.random),
  };
}
