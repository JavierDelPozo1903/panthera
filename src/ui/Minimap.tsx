import { useEffect, useMemo, useRef } from 'react';
import { useWorld } from '../core/store';
import { carcasses } from '../entities/carcass/carcassState';
import { hyenas, mother, pride, siblings } from '../entities/npc/npcState';
import { herds } from '../entities/prey/preyState';
import { wind } from '../systems/wind';
import { player } from '../entities/player/playerState';
import { getWorldMapImage } from './mapImage';

const RANGE_METERS = 240;

/** Minimapa circular orientado según la cámara (la dirección de la mirada siempre arriba). */
export function Minimap({ size = 176 }: { size?: number }) {
  const world = useWorld();
  const map = useMemo(() => getWorldMapImage(world), [world]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return; // ~30 Hz es suficiente
      last = now;

      const r = size / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#2a1d14';
      ctx.fillRect(0, 0, size, size);

      const yaw = player.cameraYaw;
      const alpha = yaw + Math.PI;
      const imgPerMeter = map.width / world.size;
      const screenPerMeter = r / RANGE_METERS;
      const u = (player.position.x + world.half) * imgPerMeter;
      const v = (player.position.z + world.half) * imgPerMeter;

      ctx.translate(r, r);
      ctx.rotate(alpha);
      ctx.scale(screenPerMeter / imgPerMeter, screenPerMeter / imgPerMeter);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(map, -u, -v);
      ctx.restore();

      // Anillos de distancia (100 m).
      ctx.strokeStyle = 'rgba(42, 29, 20, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(r, r, (100 / RANGE_METERS) * r, 0, Math.PI * 2);
      ctx.stroke();

      /** Proyecta un punto del mundo al minimapa; `clampToRim` lo fija en el borde si está lejos. */
      const toMap = (x: number, z: number, clampToRim: boolean): [number, number] | null => {
        const dx = x - player.position.x;
        const dz = z - player.position.z;
        let sx = (dx * Math.cos(alpha) - dz * Math.sin(alpha)) * screenPerMeter;
        let sy = (dx * Math.sin(alpha) + dz * Math.cos(alpha)) * screenPerMeter;
        const len = Math.hypot(sx, sy);
        if (len > r - 9) {
          if (!clampToRim) return null;
          sx *= (r - 9) / len;
          sy *= (r - 9) / len;
        }
        return [r + sx, r + sy];
      };
      const dot = (p: [number, number] | null, radius: number, fill: string) => {
        if (!p) return;
        ctx.fillStyle = fill;
        ctx.strokeStyle = '#2a1d14';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p[0], p[1], radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };

      // Madriguera.
      if (mother.active) {
        const den = toMap(mother.home.x, mother.home.z, true);
        if (den) {
          ctx.strokeStyle = '#2a1d14';
          ctx.fillStyle = 'rgba(243, 234, 215, 0.85)';
          ctx.beginPath();
          ctx.moveTo(den[0], den[1] - 6);
          ctx.lineTo(den[0] + 6, den[1] + 4);
          ctx.lineTo(den[0] - 6, den[1] + 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        if (mother.state === 'relocate') {
          const next = toMap(mother.nextHome.x, mother.nextHome.z, true);
          if (next) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#f3ead7';
            ctx.beginPath();
            ctx.arc(next[0], next[1], 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
      for (const c of carcasses) if (c.meatKg > 0.3) dot(toMap(c.position.x, c.position.z, false), 3.5, '#8a2a1c');
      for (const s of siblings) if (s.alive) dot(toMap(s.position.x, s.position.z, false), 3, '#e3cfa4');
      // Presas: puntitos verdes oliva (rojizos si huyen).
      for (const h of herds) {
        if (!h.spawned) continue;
        for (const m of h.members) {
          const p = m.alive ? toMap(m.position.x, m.position.z, false) : null;
          if (!p) continue;
          ctx.fillStyle = m.state === 'flee' ? '#b8562a' : '#5f6f2e';
          ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
        }
      }
      for (const l of pride) if (l.alive) dot(toMap(l.position.x, l.position.z, false), 3.5, '#a5602f');
      // Hienas: solo las que se ven u oyen (cerca o persiguiendo).
      for (const h of hyenas) {
        const d = Math.hypot(h.position.x - player.position.x, h.position.z - player.position.z);
        if (d < 90 || h.state === 'chase' || h.state === 'attack') dot(toMap(h.position.x, h.position.z, true), 3.5, '#b8322a');
      }
      // Madre (se fija en el borde si queda fuera de rango).
      if (mother.active && mother.state !== 'away') dot(toMap(mother.position.x, mother.position.z, true), 4.5, '#c9953c');

      // Flecha del jugador.
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(yaw - player.heading);
      ctx.fillStyle = '#f3ead7';
      ctx.strokeStyle = '#2a1d14';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Viento: flecha que indica hacia dónde sopla (tu olor viaja en esa dirección).
      {
        const wx = wind.dir.x * Math.cos(alpha) - wind.dir.y * Math.sin(alpha);
        const wy = wind.dir.x * Math.sin(alpha) + wind.dir.y * Math.cos(alpha);
        const cx = r + r * 0.62;
        const cy = r + r * 0.62;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(wy, wx));
        ctx.strokeStyle = 'rgba(42, 29, 20, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(8, 0);
        ctx.lineTo(4, -3.5);
        ctx.moveTo(8, 0);
        ctx.lineTo(4, 3.5);
        ctx.stroke();
        ctx.restore();
      }

      // Norte en el borde.
      const nx = r + Math.sin(alpha) * (r - 12);
      const ny = r - Math.cos(alpha) * (r - 12);
      ctx.fillStyle = 'rgba(42, 29, 20, 0.75)';
      ctx.beginPath();
      ctx.arc(nx, ny, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f3ead7';
      ctx.font = '600 10px Inter Variable, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny + 0.5);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map, size, world]);

  return (
    <div
      className="relative rounded-full p-[3px] shadow-[0_6px_24px_rgba(0,0,0,0.45)]"
      style={{ width: size + 6, height: size + 6, background: 'linear-gradient(145deg,#e3cfa4,#a5602f)' }}
    >
      <canvas ref={canvasRef} className="block rounded-full" style={{ width: size, height: size }} aria-label="Minimapa" />
    </div>
  );
}
