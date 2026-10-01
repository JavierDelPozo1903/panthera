import { useMemo, useState } from 'react';
import lionData from '../data/lion.json';
import { continueLife, startNewLife } from '../core/gameFlow';
import { useGame, type Sex } from '../core/store';
import { SettingsPanel } from './SettingsPanel';

const SEX_OPTIONS: { sex: Sex; title: string; text: string }[] = [
  {
    sex: 'male',
    title: 'León',
    text: 'Nace indefenso. Será expulsado entre los 2 y los 4 años, vagará como nómada y tendrá que conquistar una manada para ser rey.',
  },
  {
    sex: 'female',
    title: 'Leona',
    text: 'Nace indefensa. Permanece en su manada, caza en grupo y cría a sus cachorros hasta llegar a matriarca.',
  },
];

/** Pantalla de inicio sobre la cámara que orbita la sabana al amanecer. */
export function MainMenu() {
  const hasSave = useGame((s) => s.hasSave);
  const [sex, setSex] = useState<Sex>(useGame.getState().sex);
  const fact = useMemo(() => lionData.facts[Math.floor(Math.random() * lionData.facts.length)], []);

  return (
    <div className="absolute inset-0 flex animate-fadeIn select-none font-sans text-bone">
      <div className="absolute inset-0 bg-gradient-to-r from-night/90 via-night/55 to-transparent" />
      <div className="relative flex w-full max-w-xl flex-col justify-center px-8 py-10 sm:px-14">
        <p className="animate-riseIn text-[11px] uppercase tracking-[0.35em] text-ochre">Un simulador de vida</p>
        <h1 className="mt-3 animate-riseIn font-serif text-6xl font-light tracking-title text-bone sm:text-7xl">PANTHERA</h1>
        <p className="mt-2 animate-riseIn font-serif text-2xl italic text-sand/90">La vida del león</p>

        <div className="mt-10 animate-riseIn space-y-3" style={{ animationDelay: '0.15s' }}>
          <p className="max-w-md font-serif text-lg italic leading-snug text-bone/80">
            Empiezas como un cachorro de diez semanas junto a tu madre. Sobrevive, crece… y reina.
          </p>
          <p className="pt-2 text-[11px] uppercase tracking-[0.22em] text-sand/80">Elige a quién seguir</p>
          <div className="grid grid-cols-2 gap-3">
            {SEX_OPTIONS.map((o) => (
              <button
                key={o.sex}
                type="button"
                onClick={() => setSex(o.sex)}
                aria-pressed={sex === o.sex}
                className={`rounded-lg border p-4 text-left transition ${
                  sex === o.sex ? 'border-ochre bg-ochre/15' : 'border-bone/15 bg-black/25 hover:border-bone/40'
                }`}
              >
                <span className="font-serif text-2xl">{o.title}</span>
                <span className="mt-1.5 block text-xs leading-relaxed text-bone/65">{o.text}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex animate-riseIn flex-wrap gap-3" style={{ animationDelay: '0.3s' }}>
          <button
            type="button"
            onClick={() => startNewLife(sex)}
            className="rounded-md bg-ochre px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-umber shadow-lg transition hover:bg-sand"
          >
            Comenzar una vida
          </button>
          {hasSave && (
            <button
              type="button"
              onClick={() => void continueLife()}
              className="rounded-md border border-bone/30 px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-bone transition hover:border-bone/70"
            >
              Continuar
            </button>
          )}
        </div>

        <div className="mt-8 animate-riseIn rounded-lg bg-black/25 p-4" style={{ animationDelay: '0.45s' }}>
          <SettingsPanel compact />
        </div>

        <p className="mt-8 max-w-md border-l-2 border-ochre/60 pl-3 font-serif text-base italic leading-snug text-bone/70">
          {fact}
        </p>
      </div>
      <p className="absolute bottom-4 right-6 text-[10px] uppercase tracking-[0.25em] text-bone/40">Fase 2 · la primera hora</p>
    </div>
  );
}
