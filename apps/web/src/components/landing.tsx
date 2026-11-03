'use client';

import { useEffect, useState } from 'react';

/** Hero subline that cycles through what Sentraio does, with a pause control. */
export function RotatingLine({ items }: { items: string[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 2200);
    return () => clearInterval(t);
  }, [paused, items.length]);
  return (
    <p className="flex flex-wrap items-center gap-3 text-xl text-label2 md:text-2xl">
      <span aria-live="polite" key={i} className="fade-in font-semibold text-blue">{items[i]}</span>
      <button type="button" onClick={() => setPaused((p) => !p)} className="pill pill-gray hover:text-label" aria-pressed={paused}>
        {paused ? 'Play' : 'Pause'}
      </button>
    </p>
  );
}
