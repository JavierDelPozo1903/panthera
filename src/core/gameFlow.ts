import worldConfig from '../data/world.json';
import { resetDirector } from '../ai/director';
import { clearHyenas } from '../ai/hyenaBrain';
import { resetGroupHunt } from '../ai/huntBrain';
import { initHerds } from '../ai/preyBrain';
import { resetWildBrain } from '../ai/wildLionBrain';
import { initMatriarch } from '../ai/matriarchBrain';
import { resetDens } from '../systems/dens';
import { resetSenses } from '../systems/senses';
import { resetDefense } from '../systems/playerDefense';
import { progression, resetProgression, ATTRIBUTES } from '../systems/progression';
import { resetCombat } from '../systems/combat';
import { randomTraits, setPlayerTraits, type Traits } from '../systems/genetics';
import { playerProfile, resetProfile, SPECIES, type Coat } from '../systems/species';
import { resetQuests } from '../systems/quests';
import { lifeRoleState, resetLifeRole } from '../systems/lifeRole';
import { resetReproduction } from '../systems/reproduction';
import { playerBody, resetBody } from '../systems/wounds';
import { restoreWildLions, wildLions, type WildLion } from '../entities/npc/wildLions';
import { initTerritories, residentsOf, territories } from '../world/territories';
import { initRegions } from '../world/regions';
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
  initTerritories(world, den.motherX, den.motherZ, seed + 7);
  resetWildBrain();
  resetCombat();
  resetLifeRole(rng);
  resetReproduction();
  resetBody(playerBody);
  setPlayerTraits(randomTraits(rng));
  resetProfile();
  resetQuests();
  resetProgression();
  resetDens([{ id: 'natal', name: 'Guarida de la Acacia', x: den.motherX, z: den.motherZ, claimed: true }], 'natal');
  initRegions(world, den.motherX, den.motherZ);
  initMatriarch(world, den.motherX, den.motherZ);
  resetDefense();
  resetSenses();
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

/** Abre la pantalla de creación del cachorro. */
export function openCreation(): void {
  input.flush();
  useGame.setState({ phase: 'create' });
}

/** Vuelve a dibujar el cachorro con el aspecto elegido en la creación. */
export function previewCub(sex: Sex, traits: Traits, coat: Coat): void {
  setPlayerTraits(traits);
  playerProfile.coat = coat;
  useGame.setState((s) => ({ sex, familyVersion: s.familyVersion + 1 }));
}

/** Empieza una vida nueva con la cinemática de introducción. */
export function startNewLife(sex: Sex, profile?: Partial<typeof playerProfile>, traits?: Traits): void {
  useGame.setState({ sex });
  setupNewLitter(Date.now() & 0xffffff);
  resetProfile(profile);
  if (traits) setPlayerTraits(traits);
  // La especie fija los atributos de partida.
  const deltas = SPECIES[playerProfile.species].attributes;
  for (const a of ATTRIBUTES) progression.attributes[a] = 10 + (deltas[a] ?? 0);
  resetDefense();
  resetSenses();
  bumpFamily();
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
  recordMilestone('birth', `${playerProfile.name}, ${SPECIES[playerProfile.species].name.toLowerCase()}: naciste en un kopje del Serengeti. Tu madre se llama ${mother.name}`, true);
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
  if (save.lions) {
    const l = save.lions;
    setPlayerTraits(l.traits);
    resetBody(playerBody, l.body);
    for (const t of territories) {
      const owner = l.territoryOwners[t.id];
      if (owner) t.owner = owner;
    }
    restoreWildLions(l.wild);
    Object.assign(lifeRoleState, l.lifeRoleState);
    resetReproduction(l.repro);
    useGame.setState({ lifeRole: l.lifeRole });
  }
  if (save.souls) {
    resetProgression(save.souls.progression);
    resetProfile(save.souls.profile);
    if (save.souls.quests) resetQuests(save.souls.quests);
    resetDens(save.souls.dens, save.souls.lastDenId);
    initMatriarch(world, save.family.home[0], save.family.home[1]);
    resetDefense();
    resetSenses();
  }
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
  inheritLife(sibling.sex, 'pride');
  setPlayerTraits(randomTraits(Math.random));
  bumpFamily();
  recordMilestone(`legacy:${sibling.name}`, `Legado: la historia continúa con ${sibling.name}`);
  input.flush();
  requestPointerLock();
  void saveNow();
}

/** Restablece combate, heridas y papel social al tomar el relevo en otro león. */
function inheritLife(sex: Sex, role: 'pride' | 'nomad'): void {
  resetCombat();
  resetBody(playerBody);
  resetReproduction();
  resetLifeRole(Math.random, role);
  // Si la manada natal ya cambió de machos, no habrá un segundo relevo.
  lifeRoleState.takeoverDone = sex === 'male' || residentsOf(0).length > 0;
}

/** Edad mínima de un hijo para continuar su historia (ya no depende de la madre). */
export const HEIR_MIN_YEARS = 2;

/** Modo legado: la vida continúa en un hijo o hija ya independiente. */
export function continueAsChild(child: WildLion): void {
  const world = useGame.getState().world;
  if (!world || !child.alive || child.ageYears < HEIR_MIN_YEARS) return;
  const index = wildLions.indexOf(child);
  if (index >= 0) wildLions.splice(index, 1);
  resetPlayer(child.position.x, world.heightAt(child.position.x, child.position.z), child.position.z, child.heading);
  resetNeeds({ satiety: 0.7, hydration: 0.7, energy: 0.8, health: 1, bond: 0.6 });
  setPlayerTraits(child.traits);
  const prev = { level: progression.level, attributes: { ...progression.attributes }, relics: [...progression.relics] };
  useGame.setState({ sex: child.sex, phase: 'playing', deathInfo: null });
  // Los hijos machos ya han dejado la manada; las hijas siguen en ella.
  inheritLife(child.sex, child.sex === 'male' ? 'nomad' : 'pride');
  const attributes = { ...prev.attributes };
  for (const a of ATTRIBUTES) attributes[a] = 10 + Math.floor((prev.attributes[a] - 10) / 3);
  resetProgression({ level: Math.max(1, Math.ceil(prev.level / 3)), attributes, relics: prev.relics.slice(0, 1) });
  resetDefense();
  resetSenses();
  setAge(child.ageYears);
  bumpFamily();
  recordMilestone(`legacy:${child.name}`, `Legado: la estirpe continúa con ${child.name}, ${child.sex === 'male' ? 'tu hijo' : 'tu hija'}`);
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

/** Cierra el panel de la guarida y devuelve el control al jugador. */
export function closeDenPanel(): void {
  if (!useGame.getState().denOpen) return;
  useGame.setState({ denOpen: false });
  player.resting = false;
  input.flush();
  requestPointerLock();
  void saveNow();
}
