import { useEffect, useMemo, useRef } from 'react';
import preyData from '../data/prey.json';
import { clock } from '../core/clock';
import { useGame, useWorld } from '../core/store';
import { carcasses } from '../entities/carcass/carcassState';
import { mother, pride } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { exploration, FOG_CELLS, isRevealed } from '../systems/exploration';
import { wind } from '../systems/wind';
import { getWorldMapImage } from './mapImage';

const PAPER = 'rgb(233, 220, 192)';
const INK = '#2a1d14';

/**
 * Mapa completo (M) con estilo de cuaderno de campo: relieve, ríos y pozas, niebla de
 * guerra sobre lo no explorado, la madriguera, la manada y los avistamientos recientes.
 */
export function FullMap() {
  const open = useGame((s) => s.mapOpen);
  const world = useWorld();
  const base = useMemo(() => getWorldMapImage(world), [world]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = FOG_CELLS;
    c.height = FOG_CELLS;
    return c;
  }, []);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let fogVersion = -1;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.86);
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
      const S = size;
      const toPx = (x: number, z: number): [number, number] => [((x + world.half) / world.size) * S, ((z + world.half) / world.size) * S];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(base, 0, 0, S, S);

      // Niebla de guerra (difuminada al escalar la textura de 128²).
      if (fogVersion !== exploration.version) {
        fogVersion = exploration.version;
        const fctx = fogCanvas.getContext('2d')!;
        const img = fctx.createImageData(FOG_CELLS, FOG_CELLS);
        for (let i = 0; i < FOG_CELLS * FOG_CELLS; i++) {
          img.data[i * 4] = 233;
          img.data[i * 4 + 1] = 220;
          img.data[i * 4 + 2] = 192;
          img.data[i * 4 + 3] = exploration.revealed[i] ? 0 : 238;
        }
        fctx.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fogCanvas, 0, 0, S, S);

      ctx.font = `italic ${Math.max(11, S * 0.016)}px "Cormorant Garamond", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;

      // Pozas y kopjes descubiertos.
      for (const w of world.features.waterholes) {
        if (!isRevealed(world.size, w.x, w.z)) continue;
        const [x, y] = toPx(w.x, w.z);
        ctx.fillText('poza', x, y - 9);
      }
      for (const k of world.features.kopjes) {
        if (!isRevealed(world.size, k.x, k.z)) continue;
        const [x, y] = toPx(k.x, k.z);
        ctx.fillText('kopje', x, y + 4);
      }

      // Avistamientos.
      for (const s of exploration.sightings.values()) {
        const [x, y] = toPx(s.x, s.z);
        const age = clock.totalDays - s.when;
        ctx.globalAlpha = Math.max(0.35, 1 - age * 0.8);
        if (s.kind === 'hyenas') {
          ctx.fillStyle = '#9b2a20';
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(`hienas (${s.count})`, x, y - 8);
        } else if (s.species) {
          ctx.strokeStyle = INK;
          ctx.fillStyle = '#5f6f2e';
          ctx.beginPath();
          ctx.ellipse(x, y, 7, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = INK;
          ctx.fillText(`${preyData.species[s.species].label.toLowerCase()}s (${s.count})`, x, y - 8);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = INK;
      }

      for (const c of carcasses) {
        if (c.meatKg <= 0.3) continue;
        const [x, y] = toPx(c.position.x, c.position.z);
        ctx.fillStyle = '#7a1f15';
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }

      // Madriguera y manada.
      if (mother.active) {
        const [x, y] = toPx(mother.home.x, mother.home.z);
        ctx.fillStyle = PAPER;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 8, y + 6);
        ctx.lineTo(x - 8, y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.fillText('madriguera', x, y + 18);
      }
      const lions = [...(mother.active && mother.state !== 'away' ? [mother] : []), ...pride.filter((p) => p.alive)];
      for (const l of lions) {
        const [x, y] = toPx(l.position.x, l.position.z);
        ctx.fillStyle = '#c9953c';
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Jugador.
      const [px, py] = toPx(player.position.x, player.position.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - player.heading);
      ctx.fillStyle = '#f3ead7';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(7, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Rosa de los vientos, viento actual y escala.
      drawCompass(ctx, S - 46, 46);
      drawWind(ctx, S - 46, 112);
      drawScale(ctx, 24, S - 26, S / world.size);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, base, world, fogCanvas]);

  if (!open) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex animate-fadeIn items-center justify-center bg-night/70 backdrop-blur-sm">
      <div className="relative rounded-sm p-3 shadow-2xl" style={{ background: 'linear-gradient(135deg,#efe3c8,#d9c59c)' }}>
        <canvas ref={canvasRef} className="block" aria-label="Mapa del territorio" />
        <div className="pointer-events-none absolute left-7 top-6 rounded bg-[#efe3c8]/85 px-3 py-2 text-umber">
          <p className="text-[10px] uppercase tracking-[0.35em] text-clay">Cuaderno de campo</p>
          <p className="font-serif text-2xl">Serengeti · territorio</p>
          <p className="mt-1 text-[11px] text-earth/70">M o Esc para cerrar</p>
        </div>
      </div>
    </div>
  );
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(5, 0);
  ctx.lineTo(0, 20);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.font = '600 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -27);
  ctx.restore();
}

function drawWind(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(wind.dir.y, wind.dir.x));
  ctx.strokeStyle = '#3d5a6b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(14, 0);
  ctx.lineTo(8, -5);
  ctx.moveTo(14, 0);
  ctx.lineTo(8, 5);
  ctx.stroke();
  ctx.restore();
  ctx.font = 'italic 12px "Cormorant Garamond", serif';
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.fillText('viento', x, y + 18);
}

function drawScale(ctx: CanvasRenderingContext2D, x: number, y: number, pxPerMeter: number): void {
  const len = 500 * pxPerMeter;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + len, y - 4);
  ctx.lineTo(x + len, y + 4);
  ctx.stroke();
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('500 m', x + len + 6, y + 4);
}
