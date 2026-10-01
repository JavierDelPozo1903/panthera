import type { ReactNode } from 'react';
import { player } from '../../entities/player/playerState';
import { useTicker } from '../useTicker';

interface NeedDef {
  key: keyof typeof player.needs;
  label: string;
  icon: ReactNode;
  color: string;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
    <path d={d} />
  </svg>
);

/** Iconos sencillos: carne, gota, luna, corazón, huellas. */
const NEEDS: NeedDef[] = [
  {
    key: 'satiety',
    label: 'Hambre',
    color: '#c9953c',
    icon: <Icon d="M7 3c3 0 6 2 7 5 1 2 3 3 5 3a2 2 0 1 1-1 4 2 2 0 1 1-4 1c0-2-1-4-3-5-3-1-5-4-5-7a1 1 0 0 1 1-1Z" />,
  },
  {
    key: 'hydration',
    label: 'Sed',
    color: '#6fa3b8',
    icon: <Icon d="M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2Z" />,
  },
  {
    key: 'energy',
    label: 'Energía',
    color: '#e3cfa4',
    icon: <Icon d="M14 2a9 9 0 1 0 8 13A8 8 0 0 1 14 2Z" />,
  },
  {
    key: 'health',
    label: 'Salud',
    color: '#c0584a',
    icon: <Icon d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z" />,
  },
  {
    key: 'bond',
    label: 'Vínculo',
    color: '#8fae5a',
    icon: (
      <Icon d="M8 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM5 15a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm14 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm-7 6c-2.5 0-4.5-1.5-4.5-3.5S9.5 13 12 13s4.5 2.5 4.5 4.5S14.5 21 12 21Z" />
    ),
  },
];

/** Barras de necesidades: hambre, sed, energía, salud y vínculo social. */
export function NeedsPanel({ vertical = false }: { vertical?: boolean }) {
  const needs = useTicker(() => ({ ...player.needs }), 6);
  return (
    <div className={`flex ${vertical ? 'flex-col gap-1.5' : 'gap-3'} rounded-lg bg-umber/55 px-3 py-2 backdrop-blur-sm`}>
      {NEEDS.map((n) => {
        const value = needs[n.key];
        const critical = value < 0.2;
        return (
          <div key={n.key} className="w-16" title={n.label}>
            <div
              className={`mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] ${
                critical ? 'animate-pulse text-clay' : 'text-bone/70'
              }`}
            >
              <span style={{ color: critical ? undefined : n.color }}>{n.icon}</span>
              {n.label}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.max(2, value * 100)}%`, background: critical ? '#a5602f' : n.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
