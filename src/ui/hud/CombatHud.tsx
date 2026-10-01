import { player } from '../../entities/player/playerState';
import { combat, type CombatMove } from '../../systems/combat';
import { useTicker } from '../useTicker';


const POSTURE_LABEL: Record<CombatMove, string> = {
  swipe: 'Zarpazo',
  bite: 'Mordisco',
  threat: 'Amenaza',
};

interface FighterView {
  id: string;
  name: string;
  side: 'player' | 'enemy';
  isPlayer: boolean;
  health: number;
  stamina: number;
  posture: number;
  staggered: boolean;
  action: CombatMove | null;
  cooldown: number;
  out: boolean;
}

function readCombat() {
  return {
    active: combat.active,
    fighters: combat.fighters.map<FighterView>((f) => ({
      id: f.id,
      name: f.name,
      side: f.side,
      isPlayer: f.isPlayer,
      health: f.isPlayer ? player.needs.health : (f.agent?.health ?? 0),
      stamina: f.stamina,
      posture: f.posture,
      staggered: f.stagger > 0,
      action: f.action,
      cooldown: f.cooldown,
      out: f.out,
    })),
    lastHit: combat.elapsed - combat.lastHitTime < 2.2 ? combat.lastHit : '',
    boss: combat.reason === 'boss',
  };
}

function Bar({ value, color, className = 'h-1.5' }: { value: number; color: string; className?: string }) {
  return (
    <div className={`${className} overflow-hidden rounded-full bg-black/50`}>
      <div
        className="h-full rounded-full transition-[width] duration-100"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
      />
    </div>
  );
}

function FighterCard({ f }: { f: FighterView }) {
  const enemy = f.side === 'enemy';
  return (
    <div className={`w-44 rounded-md px-3 py-2 ${f.out ? 'opacity-40' : ''} ${enemy ? 'bg-[#3a1610]/75' : 'bg-umber/70'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate font-serif text-base ${enemy ? 'text-[#f0b9a6]' : 'text-sand'}`}>{f.name}</span>
        <span className="text-[9px] uppercase tracking-[0.15em] text-bone/60">
          {f.out ? 'Fuera' : f.action ? POSTURE_LABEL[f.action] : f.cooldown > 0 ? 'Recupera' : 'En guardia'}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        <Bar value={f.health} color="#c0584a" className="h-2" />
        <div className="grid grid-cols-2 gap-1.5">
          <Bar value={f.stamina} color="#e3cfa4" />
          <Bar value={f.posture} color={f.staggered ? '#f3ead7' : '#d9b26a'} />
        </div>
      </div>
    </div>
  );
}


/**
 * Interfaz de pelea contra leones y hienas: salud, aliento y postura de cada luchador (tus
 * aliados a la izquierda, los rivales a la derecha). Tu propia vida y tus habilidades van en
 * la barra inferior; contra un jefe se usa la barra del jefe.
 */
export function CombatHud() {
  const state = useTicker(readCombat, 15);
  if (!state.active || state.boss) return null;
  const mine = state.fighters.filter((f) => f.side === 'player' && !f.isPlayer);
  const foes = state.fighters.filter((f) => f.side === 'enemy');

  return (
    <>
      <div className="absolute inset-x-0 top-5 flex animate-fadeIn flex-col items-center gap-2">
        <p className="text-[11px] uppercase tracking-[0.4em] text-clay">Pelea</p>
        <div className="flex items-start gap-6">
          <div className="space-y-1.5">
            {mine.map((f) => (
              <FighterCard key={f.id} f={f} />
            ))}
          </div>
          <span className="mt-3 font-serif text-2xl italic text-bone/60">vs</span>
          <div className="space-y-1.5">
            {foes.map((f) => (
              <FighterCard key={f.id} f={f} />
            ))}
          </div>
        </div>
        <div className="flex gap-4 text-[9px] uppercase tracking-[0.18em] text-bone/55">
          <span>
            <span className="mr-1 inline-block h-1.5 w-3 rounded-full bg-[#c0584a]" />
            Salud
          </span>
          <span>
            <span className="mr-1 inline-block h-1.5 w-3 rounded-full bg-[#e3cfa4]" />
            Aliento
          </span>
          <span>
            <span className="mr-1 inline-block h-1.5 w-3 rounded-full bg-[#d9b26a]" />
            Postura
          </span>
        </div>
        <p className="h-7 font-serif text-xl italic text-bone drop-shadow">{state.lastHit}</p>
      </div>
    </>
  );
}
