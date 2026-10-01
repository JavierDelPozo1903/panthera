import { useEffect, useState } from 'react';
import { finishIntro } from '../core/gameFlow';
import { mother } from '../entities/npc/npcState';

export const INTRO_SECONDS = 26;

interface Caption {
  at: number;
  kicker?: string;
  text: string;
}

/** Cinemática de apertura, narrada como un documental de naturaleza. */
export function IntroOverlay() {
  const [t, setT] = useState(0);
  const captions: Caption[] = [
    { at: 0.8, kicker: 'Serengeti · Estación seca', text: 'Amanece sobre la sabana.' },
    { at: 5.5, text: 'Hace diez semanas, entre las rocas de un kopje, nacieron tres cachorros.' },
    { at: 10.5, text: `Su madre, ${mother.name}, los ha mantenido ocultos de hienas y leopardos.` },
    { at: 15.5, text: 'Más de la mitad de los cachorros de león no llega a cumplir su primer año.' },
    { at: 20.5, text: 'Hoy, por primera vez, uno de ellos sale a la luz.' },
  ];

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - start) / 1000;
      setT(elapsed);
      if (elapsed >= INTRO_SECONDS) finishIntro();
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const current = [...captions].reverse().find((c) => t >= c.at);
  const next = current ? captions[captions.indexOf(current) + 1] : undefined;
  const end = next ? next.at : INTRO_SECONDS;
  const visible = current && t < end - 0.6;

  return (
    <div className="absolute inset-0 select-none font-sans text-bone" onClick={finishIntro} role="presentation">
      <div className="absolute inset-x-0 top-0 h-[11vh] bg-black" />
      <div className="absolute inset-x-0 bottom-0 h-[11vh] bg-black" />
      <div
        className="absolute inset-0 bg-black transition-opacity duration-[2500ms]"
        style={{ opacity: t < 0.3 ? 1 : 0 }}
      />
      <div className="absolute inset-x-0 bottom-[16vh] flex justify-center px-8">
        {current && (
          <div
            key={current.at}
            className={`max-w-2xl text-center transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
          >
            {current.kicker && (
              <p className="mb-2 animate-fadeIn text-[11px] uppercase tracking-[0.4em] text-ochre">{current.kicker}</p>
            )}
            <p className="animate-riseIn font-serif text-3xl font-light italic leading-snug text-bone drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              {current.text}
            </p>
          </div>
        )}
      </div>
      <p className="absolute bottom-[3.5vh] right-8 text-[11px] uppercase tracking-[0.3em] text-bone/45">
        Espacio o clic para saltar
      </p>
    </div>
  );
}
