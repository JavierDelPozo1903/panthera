import { create } from 'zustand';
import type { LifeStageId } from '../systems/lifeStage';
import type { WorldData } from '../world/WorldData';
import { QUALITY_PRESETS, type QualityLevel, type QualityPreset } from './quality';

export type GamePhase = 'loading' | 'menu' | 'create' | 'intro' | 'playing' | 'paused' | 'dead';

/**
 * Papel del jugador en la sociedad de los leones:
 *  - pride: vive en su manada natal (cachorros, juveniles y hembras).
 *  - nomad: macho expulsado que vaga, solo o en coalición.
 *  - king: macho residente de una manada conquistada.
 */
export type LifeRole = 'pride' | 'nomad' | 'king';

export interface DeathInfo {
  cause: string;
  ageYears: number;
  day: number;
}
export type Sex = 'male' | 'female';

export interface Settings {
  quality: QualityLevel;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** Minutos reales por día de juego. */
  dayLengthMinutes: number;
  mouseSensitivity: number;
  showHints: boolean;
  subtitles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.9,
  dayLengthMinutes: 20,
  mouseSensitivity: 1,
  showHints: true,
  subtitles: true,
};

interface GameState {
  phase: GamePhase;
  loadingProgress: number;
  world: WorldData | null;
  sex: Sex;
  settings: Settings;
  hasSave: boolean;
  /** Cámara cinemática "documental". */
  documentary: boolean;
  /**
   * Escalón de crecimiento actual (edad / GROWTH_STEP_YEARS, redondeado hacia abajo).
   * Cambia pocas veces por partida: al cambiar se reconstruye el modelo del león.
   */
  growthStep: number;
  lifeStage: LifeStageId;
  deathInfo: DeathInfo | null;
  /** Se incrementa al recrear la camada (nueva vida o legado) para reconstruir actores. */
  familyVersion: number;
  /** Panel del diario de campo abierto. */
  journalOpen: boolean;
  /** Mapa completo abierto. */
  mapOpen: boolean;
  lifeRole: LifeRole;
  /** Panel de la guarida (subir de nivel y habilidades) abierto. */
  denOpen: boolean;
  /** Cuaderno de misiones abierto. */
  questsOpen: boolean;

  setPhase: (phase: GamePhase) => void;
  setLoadingProgress: (p: number) => void;
  setWorld: (world: WorldData) => void;
  setSex: (sex: Sex) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setHasSave: (v: boolean) => void;
  toggleDocumentary: () => void;
}

/**
 * Estado global de baja frecuencia (fase del juego, ajustes, selección de sexo).
 * El estado que cambia cada frame (posición, reloj) vive en objetos mutables fuera de React.
 */
export const useGame = create<GameState>((set) => ({
  phase: 'loading',
  loadingProgress: 0,
  world: null,
  sex: 'male',
  settings: DEFAULT_SETTINGS,
  hasSave: false,
  documentary: false,
  growthStep: 0,
  lifeStage: 'cub',
  deathInfo: null,
  familyVersion: 0,
  journalOpen: false,
  mapOpen: false,
  lifeRole: 'pride',
  denOpen: false,
  questsOpen: false,

  setPhase: (phase) => set({ phase }),
  setLoadingProgress: (loadingProgress) => set({ loadingProgress }),
  setWorld: (world) => set({ world }),
  setSex: (sex) => set({ sex }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setHasSave: (hasSave) => set({ hasSave }),
  toggleDocumentary: () => set((s) => ({ documentary: !s.documentary })),
}));

export const useQuality = (): QualityPreset => useGame((s) => QUALITY_PRESETS[s.settings.quality]);

/** El mundo ya generado. Solo debe llamarse desde componentes montados tras la carga. */
export const useWorld = (): WorldData => {
  const world = useGame((s) => s.world);
  if (!world) throw new Error('El mundo aún no se ha generado');
  return world;
};
