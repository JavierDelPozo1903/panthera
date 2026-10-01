import { events } from '../core/events';
import { useGame } from '../core/store';
import { player } from '../entities/player/playerState';
import { addScentMark, playerTerritory, territoryAt } from '../world/territories';
import { combat } from './combat';
import { recordMilestone } from './journal';
import { lifeRoleState, recruitableNomad, tryRecruit } from './lifeRole';
import { availableMate } from './reproduction';

export interface SocialAction {
  kind: 'mate' | 'recruit' | 'mark';
  label: string;
  run: () => void;
}

/** Edad a partir de la cual un macho marca territorio con orina y arañazos. */
const MARK_AGE = 2;

/**
 * Acción social contextual de la tecla Y, por prioridad:
 * aparearse > proponer una alianza a un nómada > marcar el territorio.
 */
export function availableSocial(): SocialAction | null {
  if (!player.alive || combat.active || !player.grounded || player.swimming) return null;
  const mate = availableMate();
  if (mate) return { kind: 'mate', label: mate.label, run: mate.run };
  const nomad = recruitableNomad();
  if (nomad) return { kind: 'recruit', label: `Proponer alianza a ${nomad.name}`, run: () => tryRecruit(nomad) };
  const { sex } = useGame.getState();
  if (sex === 'male' && player.ageYears >= MARK_AGE) return { kind: 'mark', label: 'Marcar territorio', run: markTerritory };
  return null;
}

function markTerritory(): void {
  const own = playerTerritory();
  const here = territoryAt(player.position.x, player.position.z);
  addScentMark(player.position.x, player.position.z, here?.id ?? -1, true);
  recordMilestone('first-mark', 'Primera marca de olor: orina y arañazos en la corteza de una acacia');
  if (own && here?.id === own.id) {
    // Un territorio bien marcado disuade a los nómadas durante un tiempo.
    lifeRoleState.nextChallenge = Math.min(lifeRoleState.nextChallenge + 90, 2400);
    events.emit('subtitle', { text: 'Marcas tu territorio: los nómadas lo pensarán dos veces', seconds: 2.5 });
  } else if (here && here.owner === 'rival') {
    events.emit('subtitle', { text: `Dejas tu olor en la ${here.name.toLowerCase()}: un desafío para sus residentes`, seconds: 3 });
  } else {
    events.emit('subtitle', { text: 'Dejas tu marca de olor', seconds: 2 });
  }
}
