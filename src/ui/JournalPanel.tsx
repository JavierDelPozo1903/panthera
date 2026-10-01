import { useGame } from '../core/store';
import { mother, siblings } from '../entities/npc/npcState';
import { journal } from '../systems/journal';
import { playerProfile } from '../systems/species';
import { useTicker } from './useTicker';

/** Diario de campo: el cuaderno del investigador que sigue tu vida. */
export function JournalPanel() {
  const open = useGame((s) => s.journalOpen);
  const data = useTicker(
    () => ({
      entries: [...journal.entries].reverse(),
      stats: { ...journal.stats },
      family: siblings.map((s) => ({ name: s.name, sex: s.sex, alive: s.alive })),
      motherName: mother.name,
    }),
    2,
  );
  if (!open) return null;

  return (
    <div className="pointer-events-none absolute inset-y-6 right-6 flex w-[26rem] max-w-[calc(100vw-3rem)] animate-fadeIn flex-col overflow-hidden rounded-md shadow-2xl">
      <div
        className="flex-1 overflow-y-auto px-7 py-6 text-umber"
        style={{
          background:
            'repeating-linear-gradient(0deg, transparent 0 27px, rgba(74,52,35,0.12) 27px 28px), linear-gradient(135deg, #f3ead7, #e6d6b3)',
        }}
      >
        <p className="text-[10px] uppercase tracking-[0.35em] text-clay">Diario de campo</p>
        <h3 className="mt-1 font-serif text-3xl">Notas sobre {playerProfile.name}</h3>
        <p className="mt-2 font-serif text-base italic text-earth/80">
          Madre: {data.motherName}. Hermanos:{' '}
          {data.family.map((f, i) => (
            <span key={f.name} className={f.alive ? '' : 'line-through opacity-60'}>
              {f.name} ({f.sex === 'male' ? '♂' : '♀'}){i < data.family.length - 1 ? ', ' : ''}
            </span>
          ))}
          .
        </p>

        <ul className="mt-5 space-y-3">
          {data.entries.map((e) => (
            <li key={e.id + e.day + e.time} className="border-l-2 border-clay/40 pl-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-earth/60">
                Día {e.day} · {e.time}
                {e.age && ` · ${e.age}`}
              </p>
              <p className="font-serif text-lg leading-snug">{e.text}</p>
            </li>
          ))}
          {data.entries.length === 0 && <li className="font-serif italic text-earth/60">Aún no hay anotaciones.</li>}
        </ul>

        <div className="mt-6 grid grid-cols-2 gap-2 border-t border-earth/20 pt-4 text-sm">
          <span>Recorrido: {(data.stats.distance / 1000).toFixed(2)} km</span>
          <span>Emboscadas: {data.stats.pounces}</span>
          <span>Clanes de hienas: {data.stats.hyenaEncounters}</span>
          <span>Traslados: {data.stats.denMoves}</span>
        </div>
      </div>
      <p className="bg-umber px-4 py-2 text-center text-[10px] uppercase tracking-[0.3em] text-sand">J o Esc para cerrar</p>
    </div>
  );
}
