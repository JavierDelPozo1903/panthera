import { useEffect, useRef } from 'react';
import { director } from '../../ai/director';
import { player } from '../../entities/player/playerState';

/** Viñeta roja: late con el peligro y destella al recibir daño. Pinta a 60 Hz sin React. */
export function DangerVignette() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      if (!el) return;
      const hurt = Math.max(0, 1 - player.hurtTimer / 0.6);
      const lowHealth = player.alive ? Math.max(0, 1 - player.needs.health / 0.35) : 0;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      const danger = director.danger >= 0.8 ? 0.35 + 0.15 * pulse : director.danger * 0.25;
      el.style.opacity = String(Math.min(1, Math.max(hurt, danger, lowHealth * (0.4 + 0.3 * pulse))));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 opacity-0"
      style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(120,10,5,0.75) 100%)' }}
    />
  );
}
