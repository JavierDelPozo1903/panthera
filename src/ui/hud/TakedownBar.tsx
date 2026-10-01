import preyData from '../../data/prey.json';
import { takedown } from '../../systems/takedown';
import { useTicker } from '../useTicker';

/** QTE de sujeción: barra de agarre durante el derribo de una presa. */
export function TakedownBar() {
  const state = useTicker(
    () => ({
      active: takedown.active,
      grip: takedown.grip,
      helpers: takedown.helpers,
      species: takedown.prey?.species ?? null,
    }),
    20,
  );
  if (!state.active || !state.species) return null;
  const pct = Math.max(0, Math.min(1, state.grip)) * 100;
  const danger = state.grip < 0.25;
  return (
    <div className="absolute left-1/2 top-[38%] w-80 -translate-x-1/2 animate-fadeIn text-center">
      <p className="font-serif text-2xl italic text-bone drop-shadow">Sujeta al {preyData.species[state.species].label.toLowerCase()}</p>
      <div className="mt-3 h-3 overflow-hidden rounded-full border border-bone/30 bg-black/60">
        <div
          className={`h-full transition-[width] duration-75 ${danger ? 'bg-clay' : 'bg-gradient-to-r from-ochre to-sand'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-bone/80">
        Pulsa <kbd className="rounded bg-sand px-1.5 text-xs font-bold text-umber">E</kbd> repetidamente
        {state.helpers > 0 && <span className="ml-2 text-acacia">· {state.helpers} leona(s) ayudando</span>}
      </p>
    </div>
  );
}
