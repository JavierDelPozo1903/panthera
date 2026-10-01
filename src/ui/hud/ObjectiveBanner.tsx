import { director } from '../../ai/director';
import { chainProgress, currentObjective } from '../../systems/objectives';
import { useTicker } from '../useTicker';

/** Objetivo actual, con los eventos del director (caza, hienas, traslado) por encima. */
export function ObjectiveBanner() {
  const state = useTicker(
    () => ({ text: currentObjective(director.override), urgent: director.danger >= 0.8, event: director.override !== null, ...chainProgress() }),
    4,
  );
  const tone = state.urgent ? 'border-clay/80 bg-clay/30' : state.event ? 'border-ochre/60 bg-umber/70' : 'border-bone/10 bg-umber/55';
  return (
    <div className={`rounded-lg border px-4 py-2 backdrop-blur-sm transition-colors ${tone}`}>
      <p className="text-[10px] uppercase tracking-[0.3em] text-ochre">
        {state.urgent ? '¡Peligro!' : state.event ? 'Acontecimiento' : 'Objetivo'}
        {!state.event && state.done < state.total && (
          <span className="ml-2 text-bone/40">
            {state.done}/{state.total}
          </span>
        )}
      </p>
      <p className={`mt-0.5 text-sm leading-snug ${state.urgent ? 'font-semibold text-bone' : 'text-bone/85'}`} key={state.text}>
        <span className="animate-fadeIn">{state.text}</span>
      </p>
    </div>
  );
}
