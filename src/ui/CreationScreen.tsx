import { useEffect, useState } from 'react';
import { prepareMenu, previewCub, startNewLife } from '../core/gameFlow';
import { useGame, type Sex } from '../core/store';
import type { Traits } from '../systems/genetics';
import { ATTRIBUTE_LABEL, ATTRIBUTES } from '../systems/progression';
import {
  isUnlocked,
  SPECIES,
  SPECIES_ORDER,
  TEMPERAMENTS,
  type SpeciesId,
  type Temperament,
} from '../systems/species';

const MALE_NAMES = ['Mbogo', 'Jasiri', 'Kamau', 'Duma', 'Shujaa', 'Faraji', 'Hodari', 'Zuberi'];
const FEMALE_NAMES = ['Eshe', 'Wema', 'Makena', 'Pendo', 'Subira', 'Nafula', 'Zawadi', 'Amani'];

function traitsFor(species: SpeciesId, fur: number, mane: number): Traits {
  const base = SPECIES[species].traits;
  return { maneDarkness: mane, size: base.size ?? 1, aggression: 0.5, furTint: fur };
}

/**
 * Creación del cachorro: especie, sexo, pelaje, melena, carácter y nombre. El cachorro de la
 * escena se redibuja con cada cambio, en un plano cercano.
 */
export function CreationScreen() {
  const [sex, setSex] = useState<Sex>(useGame.getState().sex);
  const [species, setSpecies] = useState<SpeciesId>('masai');
  const [fur, setFur] = useState(SPECIES.masai.traits.furTint ?? 0);
  const [mane, setMane] = useState(SPECIES.masai.traits.maneDarkness ?? 0.5);
  const [temperament, setTemperament] = useState<Temperament>('curious');
  const [name, setName] = useState('Mbogo');
  const def = SPECIES[species];

  useEffect(() => {
    previewCub(sex, traitsFor(species, fur, mane), def.coat);
  }, [sex, species, fur, mane, def.coat]);

  const chooseSpecies = (id: SpeciesId) => {
    if (!isUnlocked(id)) return;
    setSpecies(id);
    setFur(SPECIES[id].traits.furTint ?? 0);
    setMane(SPECIES[id].traits.maneDarkness ?? 0.5);
  };
  const randomName = () => {
    const list = sex === 'male' ? MALE_NAMES : FEMALE_NAMES;
    setName(list[Math.floor(Math.random() * list.length)]);
  };
  const born = () =>
    startNewLife(sex, { name: name.trim() || (sex === 'male' ? 'Mbogo' : 'Eshe'), species, temperament, coat: def.coat }, traitsFor(species, fur, mane));

  return (
    <div className="absolute inset-0 animate-fadeIn select-none font-sans text-bone">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-night/90 via-transparent to-night/90" />
      <div className="absolute left-8 top-7">
        <p className="text-[11px] uppercase tracking-[0.35em] text-ochre">Nace un nuevo cachorro</p>
        <h2 className="mt-1 font-serif text-5xl italic">¿Quién serás?</h2>
      </div>

      {/* Especies */}
      <section className="absolute bottom-8 left-8 top-36 w-[25rem] overflow-y-auto pr-2" aria-label="Especie">
        <p className="mb-2 text-[11px] uppercase tracking-[0.25em] text-sand/80">Especie</p>
        <div className="grid grid-cols-2 gap-2.5">
          {SPECIES_ORDER.map((id) => {
            const s = SPECIES[id];
            const locked = !isUnlocked(id);
            const active = id === species;
            return (
              <button
                key={id}
                type="button"
                onClick={() => chooseSpecies(id)}
                aria-pressed={active}
                disabled={locked}
                className={`rounded-md border p-3 text-left transition ${
                  active ? 'border-ochre bg-[#eaddc2] text-umber' : locked ? 'border-bone/10 bg-black/40 opacity-60' : 'border-bone/15 bg-black/35 hover:border-bone/40'
                }`}
              >
                <span className="block font-serif text-xl leading-tight">{s.name}</span>
                <span className={`mt-0.5 block text-[11px] ${active ? 'text-umber/70' : 'text-bone/55'}`}>{s.origin}</span>
                {locked ? (
                  <span className="mt-1.5 block text-[11px] font-semibold text-[#d98a6a]">🔒 {s.unlockText}</span>
                ) : (
                  <span className={`mt-1.5 block text-[11px] ${active ? 'text-umber/80' : 'text-bone/70'}`}>{s.passiveName}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-md bg-black/40 p-4">
          <p className="font-serif text-2xl italic">{def.name}</p>
          <p className="mt-1 text-sm text-bone/80">{def.description}</p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-ochre">{def.passiveName}</p>
          <p className="text-sm text-bone/85">{def.passiveText}</p>
        </div>
      </section>

      {/* Rasgos */}
      <section className="absolute bottom-8 right-8 top-36 w-[24rem] space-y-4 overflow-y-auto rounded-md bg-[#eaddc2] p-6 text-umber shadow-2xl" aria-label="Rasgos">
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.25em] text-[#9b3f2c]">Sexo</p>
          <div className="flex gap-2">
            {(['male', 'female'] as Sex[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sex === s}
                onClick={() => {
                  setSex(s);
                  setName((s === 'male' ? MALE_NAMES : FEMALE_NAMES)[0]);
                }}
                className={`flex-1 rounded-sm border px-3 py-1.5 text-sm font-semibold ${sex === s ? 'border-umber bg-umber text-[#eaddc2]' : 'border-umber/40'}`}
              >
                {s === 'male' ? 'Macho' : 'Hembra'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-umber/70">
            {sex === 'male'
              ? 'Será expulsado de la manada entre los 2 y los 4 años y tendrá que conquistar un reino.'
              : 'Se queda en su manada, caza en grupo y cría a sus cachorros.'}
          </p>
        </div>
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.25em] text-[#9b3f2c]">Pelaje</span>
          <input
            id="fur"
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={fur}
            onChange={(e) => setFur(Number(e.target.value))}
            className="mt-1 w-full accent-[#5a3a18]"
          />
          <span className="flex justify-between text-[11px] text-umber/60">
            <span>gris</span>
            <span>rojizo</span>
          </span>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.25em] text-[#9b3f2c]">Melena (cuando crezca)</span>
          <input
            id="mane"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mane}
            onChange={(e) => setMane(Number(e.target.value))}
            className="mt-1 w-full accent-[#5a3a18]"
          />
          <span className="flex justify-between text-[11px] text-umber/60">
            <span>rubia</span>
            <span>negra</span>
          </span>
        </label>
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.25em] text-[#9b3f2c]">Carácter</p>
          <div className="flex gap-2">
            {(Object.keys(TEMPERAMENTS) as Temperament[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={temperament === t}
                onClick={() => setTemperament(t)}
                className={`flex-1 rounded-sm border px-2 py-1.5 text-sm font-semibold ${temperament === t ? 'border-umber bg-umber text-[#eaddc2]' : 'border-umber/40'}`}
              >
                {TEMPERAMENTS[t].name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-umber/70">{TEMPERAMENTS[temperament].text}</p>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.25em] text-[#9b3f2c]">Atributos iniciales</p>
          <ul className="space-y-1.5">
            {ATTRIBUTES.map((a) => {
              const v = 10 + (def.attributes[a] ?? 0);
              const d = def.attributes[a] ?? 0;
              return (
                <li key={a} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <span>{ATTRIBUTE_LABEL[a]}</span>
                  <span className="h-1.5 bg-umber/15">
                    <span className="block h-full bg-[#5a3a18]" style={{ width: `${(v / 16) * 100}%` }} />
                  </span>
                  <span className={`text-right font-mono ${d > 0 ? 'text-[#4f6a2a]' : d < 0 ? 'text-[#9b3f2c]' : ''}`}>{v}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.25em] text-[#9b3f2c]">Nombre</span>
          <span className="mt-1 flex gap-2">
            <input
              id="cub-name"
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-sm border border-umber/40 bg-[#f3ead7] px-3 py-1.5 font-serif text-xl italic outline-none focus:border-umber"
            />
            <button type="button" onClick={randomName} className="rounded-sm border border-umber/40 px-3 text-sm" title="Nombre al azar">
              ↻
            </button>
          </span>
        </label>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={prepareMenu} className="rounded-sm border border-umber/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em]">
            Volver
          </button>
          <button
            type="button"
            onClick={born}
            className="flex-1 rounded-sm bg-[#9b3f2c] px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-[#eaddc2] hover:bg-[#7a1f15]"
          >
            Nacer
          </button>
        </div>
      </section>
    </div>
  );
}
