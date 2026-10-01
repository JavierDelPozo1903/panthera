/**
 * Reliquias: trofeos de jefes y recompensas de pruebas que el león lleva consigo. Siempre
 * tienen una ventaja y un coste; se equipan en la guarida (2 huecos, 3 a partir del nivel 20).
 */
export type RelicId = 'matriarchTooth' | 'secretaryFeather' | 'rainStone' | 'duelScar';

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
};

/** Compatibilidad con partidas antiguas que guardaban el nombre visible. */
export function relicIdFromName(name: string): RelicId | null {
  if (name in RELICS) return name as RelicId;
  const found = (Object.values(RELICS) as RelicDef[]).find((r) => r.name === name);
  return found ? found.id : null;
}
