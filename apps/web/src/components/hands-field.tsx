'use client';

// Full-bleed hero background: two hands reaching toward each other (Creation-of-Adam style), drawn live
// every frame on a canvas as an ASCII halftone in one blue. The luminance source is a 2×2 photo sheet of
// four isolated hands on white; each frame the current pose is drawn into a tiny offscreen "field" canvas
// (one pixel per character cell), read back, and turned into five glyph sizes. The hands drift, breathe
// and roll, periodically glitch-dissolve cell by cell into their second pose and back, and the odd row
// slides sideways like a misaligned LED wall. The fingertips fade out before the centre, and an elliptical
// quiet zone keeps the headline, the subline and the buttons clear.

import { useEffect, useRef } from 'react';

const SHEET = 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261030_025250_100df7b8-31fd-4614-aa4a-c1b7d5b6b273.png&w=1600&q=85';
// Sheet rects as fractions [x, y, w, h]. A = pointing pair, B = open pair.
const SRC = {
  LA: [0, 0.06, 0.47, 0.4], RA: [0.53, 0.06, 0.47, 0.4],
  LB: [0, 0.55, 0.47, 0.4], RB: [0.53, 0.55, 0.47, 0.4],
} as const;
const ASPECT = (0.4 * 1520) / (0.47 * 2688); // tile height / width
const LOOP = 20; // seconds
const GLYPHS = ['', '.', ':', '+', '@'];
const LEVELS = [0, 0.26, 0.52, 0.78, 1];

const fract = (x: number) => x - Math.floor(x);
const hash = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const mixAt = (t: number, on: number, off: number, dur: number) => smooth(on, on + dur, t) * (1 - smooth(off, off + dur, t));

type Tiles = Record<keyof typeof SRC, HTMLCanvasElement>;
type Grid = {
  W: number; H: number; dpr: number; step: number; rowStep: number; cols: number; rows: number;
  fA: CanvasRenderingContext2D; fB: CanvasRenderingContext2D; seed: Float32Array;
};

function makeTiles(img: HTMLImageElement): Tiles {
  const out = {} as Tiles;
  (Object.keys(SRC) as (keyof typeof SRC)[]).forEach((k) => {
    const [x, y, w, h] = SRC[k];
    const c = document.createElement('canvas');
    c.width = 420;
    c.height = Math.round(420 * ASPECT);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x * img.naturalWidth, y * img.naturalHeight, w * img.naturalWidth, h * img.naturalHeight, 0, 0, c.width, c.height);
    out[k] = c;
  });
  return out;
}

function makeGrid(W: number, H: number, dpr: number): Grid {
  const step = Math.max(5, W / 205);
  const rowStep = step * 2.0;
  const cols = Math.ceil(W / step), rows = Math.ceil(H / rowStep);
  const field = () => {
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    return c.getContext('2d', { willReadFrequently: true })!;
  };
  const seed = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) seed[j * cols + i] = 0.55 * hash(i, j) + 0.45 * hash(j * 3.1, 7.7);
  return { W, H, dpr, step, rowStep, cols, rows, fA: field(), fB: field(), seed };
}

/** Draw one hand into a field with its drift, breath and roll at time t. */
function placeHand(f: CanvasRenderingContext2D, tile: HTMLCanvasElement, left: boolean, t: number, g: Grid) {
  const { W, H, cols, rows } = g;
  const portrait = H > W;
  const a = (2 * Math.PI * t) / LOOP, ph = left ? 0 : Math.PI;
  const hw = W * (portrait ? 0.66 : 0.5), hh = hw * ASPECT;
  const cy = H * (portrait ? 0.8 : 0.82); // the hands sit under the buttons
  const reach = (0.035 * Math.sin(a + ph) + 0.012 * Math.sin(2 * a + 1.3 + ph)) * W;
  const scale = 1 + 0.07 * Math.sin(a + 0.9 + ph);
  const rot = (left ? 1 : -1) * 0.045 * Math.sin(a + 2.1 + ph);
  const x = left ? reach - W * 0.045 : W - hw + W * 0.045 - reach;
  const px = left ? 0 : W;
  f.setTransform(cols / W, 0, 0, rows / H, 0, 0);
  f.translate(px, cy); f.rotate(rot); f.scale(scale, scale); f.translate(-px, -cy);
  f.drawImage(tile, x, cy - hh / 2, hw, hh);
}

function render(ctx: CanvasRenderingContext2D, g: Grid, tiles: Tiles, t: number, blue: string) {
  const { W, H, dpr, step, rowStep, cols, rows, fA, fB, seed } = g;
  for (const f of [fA, fB]) { f.setTransform(1, 0, 0, 1, 0, 0); f.fillStyle = '#fff'; f.fillRect(0, 0, cols, rows); }
  placeHand(fA, tiles.LA, true, t, g); placeHand(fA, tiles.RA, false, t, g);
  placeHand(fB, tiles.LB, true, t, g); placeHand(fB, tiles.RB, false, t, g);
  const dA = fA.getImageData(0, 0, cols, rows).data, dB = fB.getImageData(0, 0, cols, rows).data;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = `${Math.round(rowStep * 0.85)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = blue;

  const portrait = H > W;
  const tick = Math.floor(t * 7);
  const mL = mixAt(t, 6.2, 14.6, 1.6), mR = mixAt(t, 2.4, 10.4, 1.6);
  // Quiet zone: an ellipse over the copy block (label, headline, subline, buttons). Nothing is drawn
  // inside 0.85 of its radius, and it fades to full density by 1.25.
  const qx = portrait ? 0.5 : 0.36, qy = portrait ? 0.3 : 0.42, qh = portrait ? 0.2 : 0.4;

  for (let j = 0; j < rows; j++) {
    const shift = hash(j, tick) > 0.965 ? Math.round((hash(tick, j) - 0.5) * 8) : 0;
    const py = (j + 0.5) * rowStep;
    for (let i = 0; i < cols; i++) {
      const si = Math.min(cols - 1, Math.max(0, i - shift));
      const k = j * cols + si;
      const m = si < cols / 2 ? mL : mR;
      const s = seed[k];
      const lum = (s < m ? dB : dA)[k * 4] / 255;
      // The sheet's hands are light grey on white, so the ramp starts just under white.
      let v = Math.min(1, Math.max(0, (1 - lum - 0.05) / 0.45));
      if (v <= 0) continue;
      if (m > 0.001 && m < 0.999) {
        const d = Math.abs(s - m);
        if (d < 0.12) { v *= d / 0.12; if (hash(si + tick, j) <= 0.4) v *= 0.3; }
      }
      v *= 0.86 + 0.14 * Math.sin(t * 3.2 + s * 40);
      const cx = Math.abs((i + 0.5) / cols - 0.5);
      v *= smooth(0.05, 0.13, cx); // fingertips dissolve before the centre and never touch
      v *= smooth(0.85, 1.25, Math.hypot(cx / qx, (py / H - qy) / qh)); // nothing over the copy
      let level = 0;
      for (let l = LEVELS.length - 1; l > 0; l--) if (v >= LEVELS[l] - 0.13) { level = l; break; }
      if (!level) continue;
      ctx.globalAlpha = level === 1 ? 0.55 : level === 2 ? 0.8 : 1;
      ctx.fillText(GLYPHS[level], (i + 0.5) * step, py);
    }
  }
  ctx.globalAlpha = 1;
}

export function HandsField({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const blue = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#0000ff';

    let g: Grid | null = null, tiles: Tiles | null = null, raf = 0, last = 0, dead = false;
    const t0 = performance.now();

    const frame = (t: number) => {
      if (!g || !tiles) return;
      try { render(ctx, g, tiles, t, blue); } catch (e) { dead = true; console.warn('[hands-field] stopped:', String(e)); }
    };
    const fit = () => {
      const W = host.clientWidth, H = host.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      g = makeGrid(W, H, dpr);
      if (still.matches) frame(1);
    };
    const tick = (now: number) => {
      if (dead) return;
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return; // ~30 fps
      last = now;
      frame(((now - t0) / 1000) % LOOP);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      tiles = makeTiles(img);
      if (still.matches) frame(1);
      else raf = requestAnimationFrame(tick);
    };
    img.onerror = () => console.warn('[hands-field] hand sheet failed to load; hero background stays empty');
    img.src = SHEET;

    return () => { dead = true; cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
