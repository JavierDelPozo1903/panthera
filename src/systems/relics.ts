/**
 * Reliquias: trofeos de jefes y recompensas de pruebas que el león lleva consigo. Siempre
 * tienen una ventaja y un coste; se equipan en la guarida (2 huecos, 3 a partir del nivel 20).
 */
export type RelicId =
  | 'matriarchTooth'
  | 'secretaryFeather'
  | 'rainStone'
  | 'duelScar'
  | 'deltaScale'
  | 'shadowMane'
  | 'ghostEye'
  | 'guardianHorn'
  | 'kingsCrown'
  | 'seaPearl';

export interface RelicDef {
  id: RelicId;
  name: string;
  lore: string;
  effect: string;
  cost: string;
  /** Dónde se consigue. */
  source: string;
}

export const RELICS: Record<RelicId, RelicDef> = {
  matriarchTooth: {
    id: 'matriarchTooth',
    name: 'Diente de la Matriarca',
    lore: 'Frío al tacto, como si aún aullara a una luna que ya no existe.',
    effect: 'El rugido aturde un 40 % más y asusta a las hienas.',
    cost: '−10 % de aguante máximo.',
    source: 'Vencer a La Matriarca',
  },
  secretaryFeather: {
    id: 'secretaryFeather',
    name: 'Pluma del secretario',
    lore: 'El ave que mata serpientes a patadas nunca está donde la serpiente muerde.',
    effect: 'La esquiva es invulnerable 0,06 s más.',
    cost: '−5 % de daño.',
    source: 'Prueba de la resistencia',
  },
  rainStone: {
    id: 'rainStone',
    name: 'Piedra de la lluvia',
    lore: 'Huele a tierra mojada incluso en plena estación seca.',
    effect: '+1 carga de hojas medicinales.',
    cost: '−8 % de vida máxima.',
    source: 'Hermanos de sangre',
  },
  duelScar: {
    id: 'duelScar',
    name: 'Cicatriz del primer duelo',
    lore: 'No es un objeto: es la marca que te recuerda cómo se gana.',
    effect: '+15 % de daño del mordisco.',
    cost: '+8 % de daño recibido.',
    source: 'Prueba del guerrero',
  },
  deltaScale: {
    id: 'deltaScale',
    name: 'Escama del Señor del Delta',
    lore: 'Dura como la piedra del río y igual de vieja.',
    effect: '−15 % de daño recibido.',
    cost: '−10 % de velocidad de esquiva (menos invulnerabilidad).',
    source: 'Vencer al Señor del Delta',
  },
  shadowMane: {
    id: 'shadowMane',
    name: 'Mechón de la Sombra',
    lore: 'Pelo negro que no refleja la luz del desierto.',
    effect: '+20 % de daño a la postura.',
    cost: '−8 % de vida máxima.',
    source: 'Vencer a La Sombra del Kalahari',
  },
  ghostEye: {
    id: 'ghostEye',
    name: 'Ojo del Fantasma',
    lore: 'Un ámbar que brilla cuando nadie lo mira.',
    effect: 'Ventana de contragolpe +0,08 s.',
    cost: '−5 % de daño.',
    source: 'Vencer a El Fantasma',
  },
  guardianHorn: {
    id: 'guardianHorn',
    name: 'Cuerno del Guardián',
    lore: 'Pesa como una roca y suena como un trueno lejano.',
    effect: '+25 % de aguante máximo.',
    cost: 'El aguante se recupera un 10 % más despacio.',
    source: 'Vencer al Guardián de la Niebla',
  },
  kingsCrown: {
    id: 'kingsCrown',
    name: 'Corona de huesos',
    lore: 'La llevaron tres hermanos durante cien años.',
    effect: '+20 % de daño y la furia se carga el doble de rápido.',
    cost: '+10 % de daño recibido.',
    source: 'Derrotar al Rey de Reyes',
  },
  seaPearl: {
    id: 'seaPearl',
    name: 'Perla de la marea',
    lore: 'Huele a sal en mitad del continente.',
    effect: 'Regeneras un poco de vida durante la pelea.',
    cost: '−1 carga de hojas medicinales.',
    source: 'Vencer a La Leona del Mar',
  },
};

/** Compatibilidad con partidas antiguas que guardaban el nombre visible. */
export function relicIdFromName(name: string): RelicId | null {
  if (name in RELICS) return name as RelicId;
  const found = (Object.values(RELICS) as RelicDef[]).find((r) => r.name === name);
  return found ? found.id : null;
}
