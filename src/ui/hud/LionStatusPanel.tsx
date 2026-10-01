import { useGame, type LifeRole } from '../../core/store';
import { allies, playerCubs } from '../../entities/npc/wildLions';
import { reproStatus } from '../../systems/reproduction';
import { BODY_PART_LABEL, playerBody, type BodyPart } from '../../systems/wounds';
import { playerTerritory } from '../../world/territories';
import { useTicker } from '../useTicker';

const ROLE_LABEL: Record<LifeRole, string> = {
  pride: 'En la manada natal',
  nomad: 'Nómada',
  king: '♛ Rey',
};

function severityLabel(s: number): string {
  return s > 0.6 ? 'grave' : s > 0.3 ? 'seria' : 'leve';
}

function readStatus() {
  const t = playerTerritory();
  return {
    wounds: playerBody.wounds.map((w) => ({ part: w.part, severity: w.severity, infected: w.infected })),
    scars: [...playerBody.scars] as BodyPart[],
    allies: allies().map((a) => ({ id: a.id, name: a.name, health: a.health })),
    cubs: playerCubs().length,
    territory: t?.name ?? null,
    repro: reproStatus(),
  };
}

/** Heridas, cicatrices, papel social, coalición, territorio y descendencia. */
export function LionStatusPanel() {
  const lifeRole = useGame((s) => s.lifeRole);
  const s = useTicker(readStatus, 4);
  const showRole = lifeRole !== 'pride' || s.allies.length > 0 || s.cubs > 0 || s.repro;
  if (!showRole && s.wounds.length === 0 && s.scars.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg bg-gradient-to-br from-umber/75 to-umber/40 px-4 py-3 text-xs shadow-lg backdrop-blur-sm">
      {showRole && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-serif text-base text-sand">{ROLE_LABEL[lifeRole]}</span>
            {s.territory && <span className="truncate text-[10px] text-bone/60">{s.territory}</span>}
          </div>
          {s.allies.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {s.allies.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-bone/80">
                  <span className="w-20 truncate">{a.name}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-black/40">
                    <span className="block h-full bg-[#c0584a]" style={{ width: `${a.health * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-bone/60">
            {s.cubs > 0 && <span className="mr-3">Hijos vivos: {s.cubs}</span>}
            {s.repro && <span className="text-[#e7a7c0]">{s.repro}</span>}
          </p>
        </div>
      )}
      {(s.wounds.length > 0 || s.scars.length > 0) && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-bone/50">Heridas</p>
          <ul className="mt-1 space-y-1">
            {s.wounds.map((w) => (
              <li key={w.part} className="flex items-center gap-2">
                <span className={`w-36 truncate ${w.infected ? 'animate-pulse text-clay' : 'text-bone/85'}`}>
                  {BODY_PART_LABEL[w.part]} · {w.infected ? 'infectada' : severityLabel(w.severity)}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-black/40">
                  <span className="block h-full" style={{ width: `${w.severity * 100}%`, background: w.infected ? '#8a7a2a' : '#a8322a' }} />
                </span>
              </li>
            ))}
          </ul>
          {s.scars.length > 0 && (
            <p className="mt-1 text-[10px] italic text-bone/55">Cicatrices: {s.scars.map((p) => BODY_PART_LABEL[p]).join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
