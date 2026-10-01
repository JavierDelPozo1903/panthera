import { useMemo } from 'react';
import { abandonLife, continueAsChild, continueAsSibling, HEIR_MIN_YEARS } from '../core/gameFlow';
import { playerCubs } from '../entities/npc/wildLions';
import { useGame } from '../core/store';
import { aliveSiblings } from '../entities/npc/npcState';
import { journal } from '../systems/journal';
import { formatAge } from '../systems/lifeStage';

/** Epílogo de una vida: causa, estadísticas, últimos hitos y el modo legado. */
export function DeathScreen() {
  const info = useGame((s) => s.deathInfo);
  const heirs = useMemo(() => aliveSiblings(), []);
  const children = useMemo(() => playerCubs(), []);
  const grownChildren = children.filter((c) => c.ageYears >= HEIR_MIN_YEARS);
  const stats = journal.stats;
  const lastEntries = journal.entries.filter((e) => e.id !== 'death').slice(-5);
  if (!info) return null;

  return (
    <div className="absolute inset-0 flex animate-fadeIn items-center justify-center bg-night/85 px-6 font-sans text-bone backdrop-blur-sm">
      <div className="w-full max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.4em] text-ochre">Fin de una vida</p>
        <h2 className="mt-2 font-serif text-5xl font-light">{info.cause}</h2>
        <p className="mt-3 font-serif text-xl italic text-bone/70">
          {formatAge(info.ageYears)} de vida en la sabana. {info.ageYears < 1 && 'Más de la mitad de los cachorros no llega al año.'}
        </p>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Stat label="Recorrido" value={`${(stats.distance / 1000).toFixed(2)} km`} />
          <Stat label="Tomas de leche" value={String(Math.round(stats.nursed))} />
          <Stat label="Emboscadas" value={String(stats.pounces)} />
          <Stat label="Clanes de hienas" value={String(stats.hyenaEncounters)} />
          <Stat label="Peleas ganadas" value={String(stats.fightsWon)} />
          <Stat label="Territorios" value={String(stats.territories)} />
          <Stat label="Cachorros" value={String(stats.cubsBorn)} />
          <Stat label="Presas abatidas" value={String(stats.kills)} />
        </dl>

        {lastEntries.length > 0 && (
          <div className="mt-8 border-l border-ochre/40 pl-4">
            <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-bone/50">Últimas páginas del diario</p>
            <ul className="space-y-1 font-serif text-lg italic text-bone/80">
              {lastEntries.map((e) => (
                <li key={e.id}>
                  <span className="mr-2 font-sans text-xs not-italic text-bone/40">Día {e.day}</span>
                  {e.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          {grownChildren.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => continueAsChild(c)}
              className="rounded-md bg-sand px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-umber transition hover:bg-bone"
            >
              Continuar como {c.name} ({c.sex === 'male' ? 'tu hijo' : 'tu hija'})
            </button>
          ))}
          {heirs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => continueAsSibling(s)}
              className="rounded-md bg-ochre px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-umber transition hover:bg-sand"
            >
              Continuar como {s.name} ({s.sex === 'male' ? 'macho' : 'hembra'})
            </button>
          ))}
          <button
            type="button"
            onClick={() => void abandonLife()}
            className="rounded-md border border-bone/30 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] transition hover:border-bone/70"
          >
            Empezar una nueva vida
          </button>
        </div>
        {(heirs.length > 0 || grownChildren.length > 0) && (
          <p className="mt-3 text-xs text-bone/50">
            Modo legado: la historia continúa con un hermano superviviente o con tus hijos, que heredan tus rasgos.
          </p>
        )}
        {children.length > grownChildren.length && (
          <p className="mt-1 text-xs text-bone/40">
            {children.length - grownChildren.length} de tus cachorros son aún demasiado jóvenes para seguir solos.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.25em] text-bone/50">{label}</dt>
      <dd className="mt-1 font-serif text-2xl">{value}</dd>
    </div>
  );
}
