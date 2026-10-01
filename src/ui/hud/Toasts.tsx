import { useEffect, useState } from 'react';
import { events } from '../../core/events';

interface Toast {
  id: number;
  text: string;
}

/** Avisos de hitos del diario de campo. */
export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(
    () =>
      events.on('milestone', ({ text }) => {
        const id = performance.now() + Math.random();
        setToasts((t) => [...t.slice(-2), { id, text }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5500);
      }),
    [],
  );
  return (
    <div className="absolute right-5 top-16 flex w-72 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="animate-riseIn rounded-lg border-l-2 border-ochre bg-umber/80 px-4 py-2 shadow-lg backdrop-blur">
          <p className="text-[9px] uppercase tracking-[0.3em] text-ochre">Diario de campo · nuevo hito</p>
          <p className="mt-0.5 font-serif text-base italic leading-snug text-bone">{t.text}</p>
        </div>
      ))}
    </div>
  );
}
