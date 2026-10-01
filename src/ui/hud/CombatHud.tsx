import lionData from '../../data/lion.json';
import { player } from '../../entities/player/playerState';
import { combat, type CombatMove } from '../../systems/combat';
import { useTicker } from '../useTicker';

const C = lionData.combat;

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
  morale: number;
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
      morale: f.morale,
      action: f.action,
      cooldown: f.cooldown,
      out: f.out,
    })),
    lastHit: combat.elapsed - combat.lastHitTime < 2.2 ? combat.lastHit : '',
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
          <Bar value={f.morale} color="#8fae5a" />
        </div>
      </div>
    </div>
  );
}

function MoveKey({ k, label, cost, ready }: { k: string; label: string; cost: number; ready: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-sm ${ready ? 'text-bone' : 'text-bone/40'}`}>
      <kbd className={`rounded px-1.5 text-xs font-bold ${ready ? 'bg-sand text-umber' : 'bg-bone/20 text-bone/60'}`}>{k}</kbd>
      {label}
      <span className="text-[10px] text-bone/50">−{Math.round(cost * 100)}</span>
    </div>
  );
}

/**
 * Interfaz de pelea: salud, aliento y moral de cada luchador (tu bando a la izquierda,
 * los rivales a la derecha), tu postura y los golpes disponibles.
 */
export function CombatHud() {
  const state = useTicker(readCombat, 15);
  if (!state.active) return null;
  const mine = state.fighters.filter((f) => f.side === 'player');
  const foes = state.fighters.filter((f) => f.side === 'enemy');
  const me = mine.find((f) => f.isPlayer);
  const ready = (move: CombatMove) => !!me && !me.action && me.cooldown <= 0 && me.stamina >= C[move].stamina;

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
            <span className="mr-1 inline-block h-1.5 w-3 rounded-full bg-[#8fae5a]" />
            Moral
          </span>
        </div>
        <p className="h-7 font-serif text-xl italic text-bone drop-shadow">{state.lastHit}</p>
      </div>
      <div className="absolute inset-x-0 bottom-44 flex animate-fadeIn flex-col items-center gap-1.5">
        <div className="flex flex-wrap justify-center gap-2">
          <MoveKey k="G" label="Zarpazo" cost={C.swipe.stamina} ready={ready('swipe')} />
          <MoveKey k="B" label="Mordisco" cost={C.bite.stamina} ready={ready('bite')} />
          <MoveKey k="F" label="Amenaza" cost={C.threat.stamina} ready={ready('threat')} />
        </div>
        <p className="text-xs text-bone/60 drop-shadow">
          Un zarpazo durante la preparación de un mordisco lo interrumpe · aléjate para huir
        </p>
      </div>
    </>
  );
}
