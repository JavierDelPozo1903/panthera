import { useState } from 'react';
import { closeDenPanel } from '../core/gameFlow';
import { useGame } from '../core/store';
import { lastDen } from '../systems/dens';
import {
  ABILITIES,
  ABILITY_ORDER,
  ATTRIBUTE_HINT,
  ATTRIBUTE_LABEL,
  ATTRIBUTES,
  canLevelUp,
  canRankUp,
  derivedStats,
  levelCost,
  levelUp,
  MAX_RANK,
  nextRankLevel,
  progression,
  rankUp,
  spendAttribute,
  type Attribute,
} from '../systems/progression';

/**
 * Panel de la guarida (al descansar con Z): gastar esencia para subir de nivel, repartir
 * puntos de atributo y aprender o mejorar habilidades. Estética de cuaderno de campo.
 */
export function DenPanel() {
  const open = useGame((s) => s.denOpen);
  // Contador para re-renderizar tras cada cambio (la progresión es un objeto mutable).
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  if (!open) return null;

  const p = progression;
  const s = derivedStats();
  const cost = levelCost(p.level);
  const den = lastDen();

  return (
    <div className="absolute inset-0 flex animate-fadeIn items-center justify-center bg-night/75 px-6 backdrop-blur-sm">
      <div className="grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-1 rounded-lg bg-[#4a2f1a] p-3 shadow-2xl">
        {/* Página izquierda: nivel y atributos */}
        <section className="space-y-4 rounded-l bg-[#eaddc2] p-7 text-umber">
          <p className="text-[11px] uppercase tracking-[0.3em] text-[#9b3f2c]">{den?.name ?? 'Guarida'} · subir de nivel</p>
          <div className="flex items-center gap-4">
            <div
              className="grid h-20 w-20 place-items-center rounded-full"
              style={{ background: `conic-gradient(#c9953c ${Math.min(1, p.essence / cost) * 100}%, rgba(42,29,20,.25) 0)` }}
            >
              <div className="grid h-[68px] w-[68px] place-items-center rounded-full bg-[#eaddc2]">
                <span className="text-center leading-none">
                  <span className="block text-[9px] font-semibold tracking-[0.15em]">NIVEL</span>
                  <span className="font-mono text-3xl">{p.level}</span>
                </span>
              </div>
            </div>
            <div>
              <p className="font-serif text-3xl italic">Nivel {p.level}</p>
              <p className="font-mono text-sm text-[#5a3a18]">
                Esencia {p.essence.toLocaleString('es-ES')} / {cost.toLocaleString('es-ES')}
              </p>
              <button
                type="button"
                disabled={!canLevelUp()}
                onClick={() => {
                  levelUp();
                  bump();
                }}
                className="mt-2 rounded-sm bg-[#9b3f2c] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#eaddc2] transition enabled:hover:bg-[#7a1f15] disabled:opacity-35"
              >
                Subir de nivel
              </button>
            </div>
          </div>
          <p className="font-serif text-lg italic text-[#5a3a18]">
            {p.attributePoints} puntos de atributo · {p.skillPoints} de habilidad
          </p>
          <ul className="space-y-2.5">
            {ATTRIBUTES.map((a: Attribute) => (
              <li key={a} className="grid grid-cols-[7rem_1fr_2rem_1.75rem] items-center gap-3">
                <span className="text-sm font-medium" title={ATTRIBUTE_HINT[a]}>
                  {ATTRIBUTE_LABEL[a]}
                </span>
                <span className="h-1.5 bg-umber/15">
                  <span className="block h-full bg-[#5a3a18]" style={{ width: `${Math.min(1, p.attributes[a] / 60) * 100}%` }} />
                </span>
                <span className="font-mono text-sm">{p.attributes[a]}</span>
                <button
                  type="button"
                  aria-label={`Subir ${ATTRIBUTE_LABEL[a]}`}
                  disabled={p.attributePoints <= 0}
                  onClick={() => {
                    spendAttribute(a);
                    bump();
                  }}
                  className="h-6 w-6 rounded-sm border border-[#5a3a18] text-sm font-bold disabled:opacity-30 enabled:hover:bg-[#5a3a18] enabled:hover:text-[#eaddc2]"
                >
                  +
                </button>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[#b9a47d] pt-3 text-sm">
            <dt>Vida</dt>
            <dd className="text-right font-mono">{s.maxHealthPoints}</dd>
            <dt>Daño</dt>
            <dd className="text-right font-mono">×{s.damageDealt.toFixed(2)}</dd>
            <dt>Esquiva (invulnerable)</dt>
            <dd className="text-right font-mono">{s.dodgeIFrames.toFixed(2)} s</dd>
            <dt>Ventana de contragolpe</dt>
            <dd className="text-right font-mono">{s.parryWindow.toFixed(2)} s</dd>
            <dt>Hojas medicinales</dt>
            <dd className="text-right font-mono">{p.maxHealingCharges}</dd>
          </dl>
        </section>

        {/* Página derecha: habilidades */}
        <section className="space-y-4 rounded-r bg-[#e3d4b4] p-7 text-umber">
          <p className="text-[11px] uppercase tracking-[0.3em] text-[#9b3f2c]">Habilidades · {p.skillPoints} punto(s) libre(s)</p>
          <ul className="space-y-3">
            {ABILITY_ORDER.map((id) => {
              const def = ABILITIES[id];
              const rank = p.ranks[id];
              const can = canRankUp(id);
              return (
                <li key={id} className="grid grid-cols-[3rem_1fr_auto] items-center gap-4 border-b border-[#b9a47d]/60 pb-3">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-[3px] font-bold ${
                      def.ultimate ? 'border-2 border-[#d9b26a] bg-umber text-[#d9b26a]' : rank ? 'bg-umber text-[#eaddc2]' : 'border border-dashed border-umber/60'
                    }`}
                  >
                    {def.key}
                  </span>
                  <div className="min-w-0">
                    <p className="font-serif text-2xl italic leading-tight">
                      {def.name} <span className="font-mono text-xs not-italic text-[#5a3a18]">{rank ? `rango ${'I'.repeat(rank)}` : 'sin aprender'}</span>
                    </p>
                    <p className="text-sm text-[#5a3a18]">{def.description}</p>
                    <p className="text-xs text-[#5a3a18]/80">
                      Rama {def.branch}
                      {rank < MAX_RANK && ` · siguiente rango a partir del nivel ${nextRankLevel(id)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!can}
                    onClick={() => {
                      rankUp(id);
                      bump();
                    }}
                    className="rounded-sm border border-umber px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] disabled:opacity-30 enabled:hover:bg-umber enabled:hover:text-[#eaddc2]"
                  >
                    {rank ? 'Mejorar' : 'Aprender'}
                  </button>
                </li>
              );
            })}
          </ul>
          {p.relics.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-[#9b3f2c]">Reliquias</p>
              <p className="font-serif text-lg italic">{p.relics.join(' · ')}</p>
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-[#5a3a18]">Las peleas, las cacerías, los hitos y los jefes dan esencia. Si caes, la dejas en tu rastro.</p>
            <button
              type="button"
              onClick={closeDenPanel}
              className="rounded-sm bg-umber px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#eaddc2] hover:bg-[#4a2f1a]"
            >
              Levantarse (Z)
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
