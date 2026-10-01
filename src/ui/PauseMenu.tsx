import { resumeGame, returnToMenu } from '../core/gameFlow';
import { skipToNextStage } from '../systems/aging';
import { SettingsPanel } from './SettingsPanel';

export function PauseMenu() {
  return (
    <div className="absolute inset-0 flex animate-fadeIn items-center justify-center bg-night/60 font-sans text-bone backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-bone/10 bg-umber/85 p-8 shadow-2xl">
        <p className="text-[11px] uppercase tracking-[0.35em] text-ochre">Panthera</p>
        <h2 className="mt-1 font-serif text-4xl">En pausa</h2>

        <div className="mt-6">
          <SettingsPanel />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={resumeGame}
            className="rounded-md bg-ochre px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-umber transition hover:bg-sand"
          >
            Continuar
          </button>
          <button
            type="button"
            onClick={() => {
              skipToNextStage();
              resumeGame();
            }}
            className="rounded-md border border-ochre/50 px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-sand transition hover:border-ochre"
          >
            Saltar etapa
          </button>
          <button
            type="button"
            onClick={() => void returnToMenu()}
            className="rounded-md border border-bone/30 px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] transition hover:border-bone/70"
          >
            Guardar y salir al menú
          </button>
        </div>
        <p className="mt-4 text-xs text-bone/45">La partida se guarda automáticamente cada 30 segundos.</p>
      </div>
    </div>
  );
}
