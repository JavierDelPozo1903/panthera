import { useEffect, useRef, useState } from 'react';
import { matriarch } from '../../ai/matriarchBrain';
import { events } from '../../core/events';
import { combat } from '../../systems/combat';
import { useTicker } from '../useTicker';

/** Barra del jefe, abajo y ancha, con el daño reciente en un tramo claro y la postura. */
export function BossBar() {
  const trail = useRef(1);
  const s = useTicker(() => {
    const f = combat.fighters.find((x) => x.isBoss);
    const health = matriarch.agent.health;
    // El tramo claro baja con retraso para que se vea el golpe recibido.
    trail.current = Math.max(health, trail.current - 0.006);
    if (health > trail.current) trail.current = health;
    return {
      on: matriarch.state === 'fight' && combat.active,
      health,
      trail: trail.current,
      posture: f?.posture ?? 0,
      broken: !!f && f.stagger > 0 && f.posture >= 0.99,
      phase: matriarch.phase,
    };
  }, 20);
  if (!s.on) return null;
  return (
    <div className="absolute bottom-[205px] left-1/2 w-[min(860px,60vw)] -translate-x-1/2 animate-fadeIn">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-serif text-3xl italic text-bone drop-shadow-[0_2px_6px_rgba(0,0,0,.8)]">La Matriarca</span>
        <span className="text-[11px] uppercase tracking-[0.3em] text-[#d9b26a]">
          {s.phase === 1 ? 'Reina del clan de la Luna Rota' : 'Fase II · la luna rota'}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden border border-[#d9b26a]/80 bg-black/60">
        <div className="absolute inset-y-0 left-0 bg-[#e0b070]/60" style={{ width: `${s.trail * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-[#7a1f15]" style={{ width: `${s.health * 100}%` }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-[#d9b26a]" />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.3em] text-[#d9b26a]">Postura</span>
        <div className="h-1 flex-1 overflow-hidden bg-black/50">
          <div className={`h-full ${s.broken ? 'animate-pulse bg-bone' : 'bg-[#d9b26a]'}`} style={{ width: `${s.posture * 100}%` }} />
        </div>
        {s.broken && <span className="text-xs font-semibold text-bone">¡Muerde ahora!</span>}
      </div>
    </div>
  );
}

/** Oscurecimiento del aullido del eclipse. */
export function EclipseVeil() {
  const v = useTicker(() => matriarch.eclipse, 30);
  if (v <= 0.01) return null;
  return <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 45%, rgba(40,20,70,${0.15 * v}) 0%, rgba(8,4,18,${0.75 * v}) 75%)` }} />;
}

/** Gran rótulo central: «Leyenda abatida», «Has caído». */
export function Banner() {
  const [b, setB] = useState<{ text: string; tone: string; id: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    const off = events.on('banner', ({ text, tone, seconds = 3.5 }) => {
      setB({ text, tone, id: performance.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setB(null), seconds * 1000);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);
  if (!b) return null;
  const color = b.tone === 'death' ? 'text-[#b8322a]' : b.tone === 'victory' ? 'text-[#e8c477]' : 'text-bone';
  return (
    <div key={b.id} className="absolute inset-x-0 top-[38%] flex animate-fadeIn flex-col items-center">
      <div className="h-px w-[min(900px,70vw)] bg-gradient-to-r from-transparent via-black/70 to-transparent" />
      <div className="w-full bg-gradient-to-r from-transparent via-black/60 to-transparent py-5 text-center">
        <p className={`font-serif text-6xl uppercase tracking-[0.18em] ${color} drop-shadow-[0_2px_12px_rgba(0,0,0,.9)]`}>{b.text}</p>
      </div>
      <div className="h-px w-[min(900px,70vw)] bg-gradient-to-r from-transparent via-black/70 to-transparent" />
    </div>
  );
}

interface Feat {
  id: number;
  text: string;
  kind: string;
}

/** Hazañas del combate (contragolpe, postura rota, golpe de gracia) y esencia ganada. */
export function CombatFeats() {
  const [feats, setFeats] = useState<Feat[]>([]);
  const [telegraph, setTelegraph] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    const push = (text: string, kind: string) => {
      const id = performance.now() + Math.random();
      setFeats((f) => [...f.slice(-3), { id, text, kind }]);
      window.setTimeout(() => setFeats((f) => f.filter((x) => x.id !== id)), 1800);
    };
    let tt = 0;
    const offs = [
      events.on('combat:feat', ({ text, kind }) => push(text, kind)),
      events.on('essence', ({ amount, reason }) => push(`+${amount} esencia${reason ? ` · ${reason}` : ''}`, 'essence')),
      events.on('boss:telegraph', ({ text }) => {
        setTelegraph({ text, id: performance.now() });
        window.clearTimeout(tt);
        tt = window.setTimeout(() => setTelegraph(null), 2600);
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      window.clearTimeout(tt);
    };
  }, []);
  const tone: Record<string, string> = {
    parry: 'text-[#f2c46b]',
    break: 'text-bone',
    critical: 'text-[#e8644a]',
    combo: 'text-[#e3cfa4]',
    dodge: 'text-bone/70',
    essence: 'text-[#f2c46b]',
  };
  return (
    <>
      {telegraph && (
        <div key={telegraph.id} className="absolute left-1/2 top-[24%] -translate-x-1/2 animate-fadeIn rounded bg-[#1a0c08]/75 px-5 py-2 font-serif text-2xl italic text-bone">
          {telegraph.text}
        </div>
      )}
      <div className="absolute left-1/2 top-[56%] flex -translate-x-1/2 flex-col items-center gap-1">
        {feats.map((f) => (
          <p key={f.id} className={`animate-riseIn font-serif text-2xl italic drop-shadow-[0_2px_6px_rgba(0,0,0,.9)] ${tone[f.kind] ?? 'text-bone'}`}>
            {f.text}
          </p>
        ))}
      </div>
    </>
  );
}
