import worldConfig from '../data/world.json';
import { resetDirector } from '../ai/director';
import { clearHyenas } from '../ai/hyenaBrain';
import { resetGroupHunt } from '../ai/huntBrain';
import { initHerds } from '../ai/preyBrain';
import { resetTakedown } from '../systems/takedown';
import { resetExploration } from '../systems/exploration';
import { clearCarcasses } from '../entities/carcass/carcassState';
import { mother, pride, resetFamily, resetMother, siblings, type Agent, type SiblingState } from '../entities/npc/npcState';
import { player, resetNeeds, resetPlayer } from '../entities/player/playerState';
import { setAge } from '../systems/aging';
import { recordMilestone, resetJournal } from '../systems/journal';
import { START_AGE_YEARS } from '../systems/lifeStage';
import { denSite } from '../world/den';
import { clock } from './clock';
import { input } from './input';
import { mulberry32 } from './math';
import { captureSave, clearSave, loadGame, writeSave } from './save';
import { useGame, type Sex } from './store';

/** Transiciones de alto nivel del juego (menú → intro → partida ↔ pausa → muerte/legado). */

let canvasElement: HTMLElement | null = null;

export function registerCanvas(el: HTMLElement | null): void {
  canvasElement = el;
}

export function requestPointerLock(): void {
  if (!canvasElement || document.pointerLockElement === canvasElement) return;
  try {
    // Chrome devuelve una promesa que se rechaza si se pide demasiado pronto tras salir.
    const result = canvasElement.requestPointerLock() as unknown as Promise<void> | undefined;
    result?.catch?.(() => undefined);
  } catch {
    /* el arrastre con ratón sigue funcionando como alternativa */
  }
}

function releasePointerLock(): void {
  if (document.pointerLockElement) document.exitPointerLock();
}

const bumpFamily = () => useGame.setState((s) => ({ familyVersion: s.familyVersion + 1 }));

/** Nueva camada en la madriguera natal: cachorro, madre y dos hermanos. */
function setupNewLitter(seed: number): void {
  const world = useGame.getState().world;
  if (!world) return;
  const den = denSite(world);
  const rng = mulberry32(seed);
  resetPlayer(den.x, world.heightAt(den.x, den.z), den.z, den.heading);
  resetNeeds();
  resetMother(den.motherX, world.heightAt(den.motherX, den.motherZ), den.motherZ, den.heading + 0.6);
  resetFamily(rng, den.motherX, den.motherZ, (x, z) => world.heightAt(x, z), START_AGE_YEARS);
  clearCarcasses();
  clearHyenas();
  resetJournal();
  resetDirector();
  resetGroupHunt();
  resetTakedown();
  initHerds(world, seed + 99);
  resetExploration();
  setAge(START_AGE_YEARS);
  bumpFamily();
}

export function prepareMenu(): void {
  setupNewLitter(12345);
  clock.reset();
  input.flush();
  useGame.setState({ phase: 'menu', documentary: false, deathInfo: null, journalOpen: false });
}

/** Empieza una vida nueva con la cinemática de introducción. */
export function startNewLife(sex: Sex): void {
  useGame.setState({ sex });
  setupNewLitter(Date.now() & 0xffffff);
  clock.reset();
  clock.timeOfDay = 6.45;
  input.flush();
  useGame.setState({ phase: 'intro', documentary: false, deathInfo: null, journalOpen: false });
  void clearSave();
  useGame.getState().setHasSave(false);
}

/** Termina (o salta) la introducción y cede el control al jugador. */
export function finishIntro(): void {
  if (useGame.getState().phase !== 'intro') return;
  input.flush();
  useGame.setState({ phase: 'playing' });
  recordMilestone('birth', `Naciste en un kopje del Serengeti. Tu madre se llama ${mother.name}`, true);
  requestPointerLock();
}

export async function continueLife(): Promise<void> {
  const save = await loadGame(worldConfig.seed);
  const world = useGame.getState().world;
  if (!save || !world) return;
  useGame.setState({ sex: save.sex });
  setupNewLitter(save.savedAt & 0xffffff);
  // Restaura la familia tal como estaba.
  const [hx, hz] = save.family.home;
  mother.name = save.family.motherName;
  resetMother(hx + 3, world.heightAt(hx + 3, hz), hz, 0);
  mother.home.set(hx, world.heightAt(hx, hz), hz);
  save.family.siblings.forEach((data, i) => {
    const s = siblings[i];
    if (!s) return;
    s.name = data.name;
    s.sex = data.sex;
    s.alive = data.alive;
    s.state = data.alive ? 'rest' : 'dead';
    // Los hermanos esperan junto al jugador.
    const x = save.player.x + 1.5 * (i === 0 ? 1 : -1);
    s.position.set(x, world.heightAt(x, save.player.z), save.player.z);
  });
  save.family.pride?.forEach((data, i) => {
    const p = pride[i];
    if (!p) return;
    p.name = data.name;
    p.alive = data.alive;
  });
  if (save.explored) resetExploration(save.explored);
  resetPlayer(save.player.x, save.player.y, save.player.z, save.player.heading);
  player.stamina = save.player.stamina;
  resetNeeds(save.player.needs);
  resetJournal(save.journal.entries, save.journal.stats);
  setAge(save.player.ageYears);
  clock.restore(save.clock);
  bumpFamily();
  input.flush();
  useGame.setState({ phase: 'playing', documentary: false, deathInfo: null });
  requestPointerLock();
}

/** Modo legado: tras morir, la vida continúa en un hermano superviviente. */
export function continueAsSibling(sibling: Agent<SiblingState>): void {
  const world = useGame.getState().world;
  if (!world || !sibling.alive) return;
  const index = siblings.indexOf(sibling);
  if (index >= 0) siblings.splice(index, 1);
  resetPlayer(sibling.position.x, world.heightAt(sibling.position.x, sibling.position.z), sibling.position.z, sibling.heading);
  resetNeeds({ satiety: 0.7, hydration: 0.7, energy: 0.8, health: 1, bond: 0.8 });
  useGame.setState({ sex: sibling.sex, phase: 'playing', deathInfo: null });
  bumpFamily();
  recordMilestone(`legacy:${sibling.name}`, `Legado: la historia continúa con ${sibling.name}`);
  input.flush();
  requestPointerLock();
  void saveNow();
}

export function pauseGame(): void {
  if (useGame.getState().phase !== 'playing') return;
  useGame.setState({ phase: 'paused', journalOpen: false });
  releasePointerLock();
  void saveNow();
}

export function resumeGame(): void {
  if (useGame.getState().phase !== 'paused') return;
  input.flush();
  useGame.setState({ phase: 'playing' });
  requestPointerLock();
}

export async function saveNow(): Promise<void> {
  const { sex, phase } = useGame.getState();
  if ((phase !== 'playing' && phase !== 'paused') || !player.alive) return;
  await writeSave(captureSave(sex, worldConfig.seed));
  useGame.getState().setHasSave(true);
}

export async function returnToMenu(): Promise<void> {
  await saveNow();
  releasePointerLock();
  prepareMenu();
}

/** Tras una muerte sin legado posible: la partida guardada deja de tener sentido. */
export async function abandonLife(): Promise<void> {
  await clearSave();
  useGame.getState().setHasSave(false);
  prepareMenu();
}
