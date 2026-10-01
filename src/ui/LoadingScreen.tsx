import { useMemo } from 'react';
import lionData from '../data/lion.json';
import { useGame } from '../core/store';

export function LoadingScreen({ error }: { error: string | null }) {
  const progress = useGame((s) => s.loadingProgress);
  const fact = useMemo(() => lionData.facts[Math.floor(Math.random() * lionData.facts.length)], []);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-night font-sans text-bone">
      <h1 className="font-serif text-5xl font-light tracking-title">PANTHERA</h1>
      <p className="mt-2 font-serif text-xl italic text-sand/80">La vida del león</p>
      {error ? (
        <p className="mt-10 max-w-md text-center text-sm text-clay">No se pudo generar el mundo: {error}</p>
      ) : (
        <div className="mt-12 w-72">
          <div className="mb-2 flex justify-between text-[11px] uppercase tracking-[0.22em] text-bone/60">
            <span>Generando la sabana</span>
            <span className="tabular-nums">{Math.round(progress * 100)} %</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-bone/10">
            <div className="h-full bg-ochre transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
      <p className="mt-12 max-w-md px-6 text-center font-serif text-base italic text-bone/55">{fact}</p>
    </div>
  );
}
