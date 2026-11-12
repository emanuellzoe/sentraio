// Plain line icons; they inherit the text colour so they never carry their own fill.

export type IconName = 'magnifier' | 'lock' | 'xray' | 'operator';

export function Glyph({ name, className = 'h-6 w-6' }: { name: IconName; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {name === 'magnifier' && (<><circle cx="10.5" cy="10.5" r="6" {...common} /><path d="M15 15l5 5" {...common} /></>)}
      {name === 'lock' && (<><rect x="5" y="11" width="14" height="10" rx="2.5" {...common} /><path d="M8 11V8a4 4 0 018 0v3" {...common} /></>)}
      {name === 'xray' && <path d="M3 12h4l2-5 4 10 2-5h6" {...common} />}
      {name === 'operator' && (<><path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3M11 12h9" {...common} /><circle cx="15" cy="7" r="2" {...common} /><circle cx="9" cy="17" r="2" {...common} /></>)}
    </svg>
  );
}
