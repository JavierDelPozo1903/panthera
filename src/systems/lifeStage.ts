import lionData from '../data/lion.json';
import { smoothstep } from '../core/math';
import type { Sex } from '../core/store';

export type LifeStageId = 'cub' | 'juvenile' | 'subadult' | 'adult' | 'elder';

export interface LifeStage {
  id: LifeStageId;
  fromYears: number;
  toYears: number;
}

export const LIFE_STAGES: LifeStage[] = lionData.lifeStages.map((s) => ({
  id: s.id as LifeStageId,
  fromYears: s.fromMonths / 12,
  toYears: s.toMonths / 12,
}));

/** Edad al empezar: ~10 semanas, cuando los cachorros salen por primera vez de la madriguera. */
export const START_AGE_YEARS = 0.2;

/** Granularidad con la que se reconstruye el modelo al crecer (tamaño, manchas, melena). */
export const GROWTH_STEP_YEARS = 0.25;

/** Edad a la que la madre deja de acompañar (los subadultos ya se valen solos). */
export const MOTHER_CARE_UNTIL_YEARS = 2;

export function stageAt(ageYears: number): LifeStage {
  return LIFE_STAGES.find((s) => ageYears < s.toYears) ?? LIFE_STAGES[LIFE_STAGES.length - 1];
}

export function nextStage(stage: LifeStage): LifeStage | null {
  const i = LIFE_STAGES.indexOf(stage);
  return i >= 0 && i < LIFE_STAGES.length - 1 ? LIFE_STAGES[i + 1] : null;
}

/** Nombre de la etapa: la experiencia de macho y hembra diverge desde el subadulto. */
export function stageTitle(id: LifeStageId, sex: Sex): string {
  const male = sex === 'male';
  switch (id) {
    case 'cub':
      return male ? 'Cachorro' : 'Cachorra';
    case 'juvenile':
      return 'Juvenil';
    case 'subadult':
      return male ? 'Nómada' : 'Joven cazadora';
    case 'adult':
      return male ? 'Aspirante al trono' : 'Leona de la manada';
    case 'elder':
      return male ? 'Viejo león' : 'Matriarca';
  }
}

/** Objetivo vital de cada etapa: el hilo conductor hasta convertirse en rey (o matriarca). */
export function stageObjective(id: LifeStageId, sex: Sex): string {
  const male = sex === 'male';
  switch (id) {
    case 'cub':
      return 'Sobrevive: no te alejes de tu madre y escóndete en la hierba alta.';
    case 'juvenile':
      return 'Acompaña las cacerías y aprende a acechar.';
    case 'subadult':
      return male
        ? 'Te expulsarán de la manada: busca aliados para formar una coalición.'
        : 'Participa en la caza cooperativa de la manada.';
    case 'adult':
      return male
        ? 'Desafía a los machos residentes y conquista una manada: conviértete en el rey.'
        : 'Cría a tus cachorros y defiende el territorio.';
    case 'elder':
      return male ? 'Defiende tu reinado mientras las fuerzas te acompañen.' : 'Guía a la manada con tu experiencia.';
  }
}

/** Hitos del camino al trono (se muestran en el HUD y en el diario de campo). */
export function lifePath(sex: Sex): string[] {
  return sex === 'male'
    ? ['Cachorro', 'Juvenil', 'Nómada', 'Coalición', 'Rey de la manada']
    : ['Cachorra', 'Juvenil', 'Cazadora', 'Madre', 'Matriarca'];
}

/** Índice del hito alcanzado en `lifePath` (los dos últimos exigen conquistas, no solo edad). */
export function lifePathIndex(id: LifeStageId): number {
  return id === 'cub' ? 0 : id === 'juvenile' ? 1 : 2;
}

export function formatAge(ageYears: number): string {
  const totalMonths = Math.floor(ageYears * 12);
  if (totalMonths < 1) return `${Math.max(1, Math.floor(ageYears * 52))} semanas`;
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const y = years === 1 ? '1 año' : `${years} años`;
  const m = months === 1 ? '1 mes' : `${months} meses`;
  if (years === 0) return m;
  return months === 0 ? y : `${y} y ${m}`;
}

/** Capacidades físicas según la edad [0, 1]: los cachorros son lentos y se cansan pronto. */
export function physicalMaturity(ageYears: number): number {
  // Curva cóncava: los progresos del primer y segundo año se notan mucho.
  return Math.pow(smoothstep(0, 3.5, ageYears), 0.6);
}

/** Los leones empiezan a rugir de verdad hacia el año de vida. */
export function canRoar(ageYears: number): boolean {
  return ageYears >= 1;
}
