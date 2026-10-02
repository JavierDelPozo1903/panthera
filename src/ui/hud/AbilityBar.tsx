import type { ReactNode } from 'react';
import { player } from '../../entities/player/playerState';
import { abilities, combat, furyActive } from '../../systems/combat';
import { defense } from '../../systems/playerDefense';
import {
  ABILITIES,
  ABILITY_ORDER,
  abilityCooldown,
  derivedStats,
  levelCost,
  progression,
  type AbilityId,
} from '../../systems/progression';
import { useTicker } from '../useTicker';
import { input, PAD_LABELS } from '../../core/input';

/** Iconos de tinta de cada habilidad (mismo dibujo que en el diseño de Figma). */
const ICONS: Record<string, ReactNode> = {
  claw: <path d="M14 48 L28 8 M25 50 L39 10 M36 52 L50 12" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />,
  bite: (
    <path
      d="M6 14 L14 26 L22 14 L30 26 L38 14 L46 26 L52 14 M6 44 L14 32 L22 44 L30 32 L38 44 L46 32 L52 44"
      stroke="currentColor"
      strokeWidth="4"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  charge: (
    <path d="M18 28 H44 M34 16 L48 28 L34 40 M6 20 H16 M4 28 H12 M6 36 H16" stroke="currentColor" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  ),
  roar: (
    <>
      <circle cx="12" cy="28" r="5" fill="currentColor" />
      <path d="M22 18 A12 12 0 0 1 22 38 M30 12 A20 20 0 0 1 30 44 M38 6 A28 28 0 0 1 38 50" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
    </>
  ),
  tear: <path d="M12 12 L44 44 M44 12 L12 44 M8 30 L20 42 M36 14 L48 26" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />,
  fury: <path d="M8 42 L10 16 L20 28 L28 10 L36 28 L46 16 L48 42 Z M8 44 H48 V49 H8 Z" fill="currentColor" />,
  leaf: (
    <>
      <path d="M28 50 C10 40 8 18 22 6 C30 20 32 36 28 50 Z" fill="currentColor" />
      <path d="M30 50 C46 42 50 24 42 12 C34 24 30 38 30 50 Z" fill="currentColor" opacity=".7" />
    </>
  ),
};

const ABILITY_ICON: Record<AbilityId, string> = { charge: 'charge', roar: 'roar', tear: 'tear', fury: 'fury' };

function read() {
  const s = derivedStats();
  return {
    level: progression.level,
    essence: progression.essence,
    nextCost: levelCost(progression.level),
    ranks: { ...progression.ranks },
    cooldowns: { ...abilities.cooldowns },
    fury: abilities.furyGauge,
    furyOn: furyActive(),
    healing: progression.healingCharges,
    hp: Math.round(player.needs.health * s.maxHealthPoints),
    maxHp: s.maxHealthPoints,
    health: player.needs.health,
    stamina: defense.stamina / s.maxStamina,
    inFight: combat.active,
    guarding: defense.guarding,
    dropped: progression.dropped?.amount ?? 0,
    pad: input.lastDevice === 'pad',
  };
}

interface SlotProps {
  icon: string;
  keyLabel: string;
  title: string;
  /** Fracción de recarga restante [0, 1] y segundos. */
  cd?: number;
  seconds?: number;
  locked?: string;
  ultimate?: boolean;
  ready?: boolean;
  count?: number;
}

function Slot({ icon, keyLabel, title, cd = 0, seconds = 0, locked, ultimate, ready, count }: SlotProps) {
  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <div
        className={`relative grid h-14 w-14 place-items-center overflow-hidden rounded-[3px] bg-umber/90 ${
          ultimate ? (ready ? 'border-2 border-[#d9b26a] shadow-[0_0_14px_rgba(217,178,106,.6)]' : 'border-2 border-[#d9b26a]/40') : 'border border-[#b9a47d]'
        }`}
      >
        <svg viewBox="0 0 56 56" className={`h-10 w-10 ${locked ? 'text-[#5a3a18]' : ultimate ? 'text-[#d9b26a]' : 'text-[#eaddc2]'}`} aria-hidden>
          {ICONS[icon]}
        </svg>
        {cd > 0 && (
          <div
            className="absolute inset-0 grid place-items-center font-mono text-lg font-semibold text-bone"
            style={{ background: `conic-gradient(rgba(0,0,0,.66) ${cd * 100}%, transparent 0)` }}
          >
            {seconds > 0 ? Math.ceil(seconds) : ''}
          </div>
        )}
        {locked && <div className="absolute inset-0 grid place-items-center bg-black/55 text-[10px] font-semibold text-[#b9a47d]">{locked}</div>}
        {count !== undefined && <span className="absolute bottom-0.5 right-1 font-mono text-[11px] text-bone">×{count}</span>}
      </div>
      <span className="rounded-[2px] border border-[#5a3a18] bg-[#eaddc2] px-1.5 text-[10px] font-bold leading-4 text-umber">{keyLabel}</span>
    </div>
  );
}

/**
 * Barra de habilidades al estilo de los MOBA: cada habilidad en un cuadrado con su icono y la
 * tecla debajo; mientras recarga, una sombra en abanico y los segundos que faltan. Encima del
 * todo, el nivel con el progreso de esencia; debajo, vida, aguante y furia.
 */
export function AbilityBar() {
  const s = useTicker(read, 15);
  if (player.ageYears < 1) return null;
  const xp = Math.min(1, s.essence / s.nextCost);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-end gap-2.5">
        <div
          className="grid h-16 w-16 place-items-center rounded-full"
          style={{ background: `conic-gradient(#c9953c ${xp * 100}%, rgba(42,29,20,.6) 0)` }}
          title={`Esencia ${s.essence} / ${s.nextCost} para el siguiente nivel`}
        >
          <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-[#eaddc2] text-center text-umber">
            <span className="leading-none">
              <span className="block text-[8px] font-semibold tracking-[0.15em]">NIVEL</span>
              <span className="font-mono text-xl font-semibold">{s.level}</span>
            </span>
          </div>
        </div>
        <Slot icon="claw" keyLabel={s.pad ? PAD_LABELS.attack! : 'CLIC'} title="Zarpazo (encadena hasta 4)" />
        <Slot icon="bite" keyLabel={s.pad ? PAD_LABELS.heavy! : 'CLIC D'} title="Mordisco (golpe de gracia si la postura está rota)" />
        <span className="mb-6 h-12 w-px bg-bone/30" />
        {ABILITY_ORDER.map((id) => {
          const def = ABILITIES[id];
          const rank = s.ranks[id];
          const total = abilityCooldown(id);
          const isUlt = !!def.ultimate;
          return (
            <Slot
              key={id}
              icon={ABILITY_ICON[id]}
              keyLabel={s.pad ? PAD_LABELS[`ability${ABILITY_ORDER.indexOf(id) + 1}` as 'ability1']! : def.key}
              title={`${def.name}${rank ? ` (rango ${rank})` : ''}: ${def.description}`}
              cd={isUlt ? (rank ? 1 - s.fury : 0) : total > 0 ? s.cooldowns[id] / total : 0}
              seconds={isUlt ? 0 : s.cooldowns[id]}
              locked={rank === 0 ? `Nv ${def.unlockLevel}` : undefined}
              ultimate={isUlt}
              ready={isUlt && (s.fury >= 1 || s.furyOn)}
            />
          );
        })}
        <span className="mb-6 h-12 w-px bg-bone/30" />
        <Slot icon="leaf" keyLabel={s.pad ? PAD_LABELS.heal! : '1'} title="Hojas medicinales: curan un 35 %" count={s.healing} />
      </div>
      <div className="w-[520px] space-y-1">
        <div className="relative h-3.5 overflow-hidden rounded-[2px] border border-[#b9a47d]/70 bg-black/55">
          <div className="h-full bg-[#9b3f2c] transition-[width] duration-150" style={{ width: `${s.health * 100}%` }} />
          <span className="absolute inset-0 grid place-items-center font-mono text-[10px] text-bone">
            {s.hp} / {s.maxHp}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-[2px] bg-black/55">
          <div className={`h-full transition-[width] duration-100 ${s.guarding ? 'bg-sand' : 'bg-[#eaddc2]'}`} style={{ width: `${Math.max(0, s.stamina) * 100}%` }} />
        </div>
        <div className="h-1 overflow-hidden rounded-[2px] bg-black/45">
          <div className={`h-full ${s.furyOn ? 'animate-pulse bg-[#f2c46b]' : 'bg-[#d9b26a]'}`} style={{ width: `${(s.furyOn ? 1 : s.fury) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Contador de esencia (esquina inferior derecha, como en los souls). */
export function EssenceCounter() {
  const s = useTicker(() => ({ essence: progression.essence, dropped: progression.dropped?.amount ?? 0 }), 6);
  if (player.ageYears < 1 && s.essence === 0) return null;
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-[0.25em] text-bone/60">Esencia del linaje</p>
      <p className="font-mono text-2xl text-[#f2c46b] drop-shadow">{s.essence.toLocaleString('es-ES')}</p>
      {s.dropped > 0 && <p className="text-[11px] text-bone/60">{s.dropped.toLocaleString('es-ES')} en tu rastro</p>}
    </div>
  );
}
