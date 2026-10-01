import { useState } from 'react';
import { useGame } from '../core/store';
import { QUEST_KIND_LABEL, QUESTS, questState, trackQuest, type QuestKind } from '../systems/quests';
import { RELICS } from '../systems/relics';
import { useTicker } from './useTicker';

const KINDS: QuestKind[] = ['main', 'pride', 'hunt', 'trial'];

/** Cuaderno de misiones (K): lista por tipos y detalle con los pasos tachados a mano. */
export function QuestPanel() {
  const open = useGame((s) => s.questsOpen);
  const [kind, setKind] = useState<QuestKind>('main');
  const [selected, setSelected] = useState<string | null>(null);
  const snap = useTicker(() => ({ status: { ...questState.status }, step: { ...questState.step }, tracked: questState.tracked }), 3);
  if (!open) return null;

  const visible = QUESTS.filter((q) => q.kind === kind && snap.status[q.id] !== 'hidden');
  const current = QUESTS.find((q) => q.id === (selected ?? snap.tracked)) ?? visible[0];
  const total = QUESTS.filter((q) => snap.status[q.id] === 'done').length;

  return (
    <div className="absolute inset-0 flex animate-fadeIn items-center justify-center bg-night/70 px-6 backdrop-blur-sm">
      <div className="grid w-full max-w-5xl grid-cols-2 gap-1 rounded-lg bg-[#4a2f1a] p-3 shadow-2xl">
        <section className="min-h-[34rem] space-y-4 rounded-l bg-[#eaddc2] p-7 text-umber">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#9b3f2c]">Misiones</p>
            <p className="font-mono text-xs text-[#5a3a18]">{total} cumplidas</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setSelected(null);
                }}
                className={`rounded-sm border px-2.5 py-1 text-xs font-semibold ${kind === k ? 'border-umber bg-umber text-[#eaddc2]' : 'border-umber/40'}`}
              >
                {QUEST_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <ul className="space-y-1.5">
            {visible.length === 0 && <li className="font-serif text-lg italic text-[#5a3a18]">Aún no hay misiones de este tipo.</li>}
            {visible.map((q) => {
              const done = snap.status[q.id] === 'done';
              const isCurrent = current?.id === q.id;
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(q.id)}
                    className={`flex w-full items-baseline gap-3 px-2 py-1 text-left ${isCurrent ? 'outline outline-2 outline-[#c9953c]' : ''}`}
                  >
                    <span className="w-14 text-[10px] uppercase tracking-[0.15em] text-[#9b3f2c]">
                      {done ? 'Hecha' : snap.tracked === q.id ? 'Seguida' : 'Activa'}
                    </span>
                    <span className={`font-serif text-2xl italic ${done ? 'line-through opacity-50' : ''}`}>{q.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="min-h-[34rem] space-y-4 rounded-r bg-[#e3d4b4] p-7 text-umber">
          {current ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.3em] text-[#9b3f2c]">{QUEST_KIND_LABEL[current.kind]}</p>
              <h3 className="font-serif text-4xl italic leading-tight">{current.title}</h3>
              <p className="font-serif text-lg italic leading-snug text-[#5a3a18]">{current.summary}</p>
              <ul className="space-y-2">
                {current.steps.map((s, i) => {
                  const step = snap.step[current.id] ?? 0;
                  const done = snap.status[current.id] === 'done' || i < step;
                  return (
                    <li key={s.text} className={`font-serif text-xl ${done ? 'line-through opacity-55' : i === step ? '' : 'opacity-60'}`}>
                      {done ? '✓' : '○'} {s.text}
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-[#b9a47d] pt-3 text-sm">
                <p>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[#5a3a18]">Recompensa</span> {current.reward.essence} de esencia
                  {current.reward.relic && ` · reliquia: ${RELICS[current.reward.relic].name}`}
                </p>
              </div>
              {snap.status[current.id] === 'active' && snap.tracked !== current.id && (
                <button type="button" onClick={() => trackQuest(current.id)} className="rounded-sm bg-umber px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#eaddc2]">
                  Seguir esta misión
                </button>
              )}
            </>
          ) : (
            <p className="font-serif text-xl italic">Sin misiones por ahora.</p>
          )}
          <p className="pt-4 text-xs text-[#5a3a18]">K o Esc para cerrar</p>
        </section>
      </div>
    </div>
  );
}
