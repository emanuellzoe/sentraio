// Hero illustration in an Apple-icon style: a gradient shield with a check mark;
// red "payments" fly in, bounce off with a spark, and the shield ripples on each hit.
// Impacts land every second at 0.74 s past the second (58% of a 3 s cycle, staggered).

const SHIELD = 'M240 34c22 10 42 14 58 14v54c0 38-26 66-58 80-32-14-58-42-58-80V48c16 0 36-4 58-14z';
const HIT_X = 172; // just left of the shield edge
const SHOTS = [
  { y: 78, delay: 0 },
  { y: 108, delay: -1 },
  { y: 138, delay: -2 },
];
const SPARKS = [
  { dx: -16, dy: -12 },
  { dx: -22, dy: 0 },
  { dx: -16, dy: 12 },
];

export function ShieldHero({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 210" className={className} role="img" aria-label="A shield deflecting incoming payments">
      <defs>
        <linearGradient id="sh-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--blue)" />
          <stop offset="1" stopColor="var(--indigo)" />
        </linearGradient>
        <linearGradient id="sh-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="sh-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="var(--blue)" floodOpacity="0.3" />
        </filter>
      </defs>

      {SHOTS.map((s, i) => (
        <g key={i}>
          <g className="sh-shot" style={{ animationDelay: `${s.delay}s`, ['--travel' as string]: `${HIT_X - 12}px` }}>
            <circle cx={12} cy={s.y} r={7} fill="var(--red)" />
            <circle cx={-6} cy={s.y} r={3} fill="var(--red)" opacity={0.4} />
            <circle cx={-18} cy={s.y} r={2} fill="var(--red)" opacity={0.2} />
          </g>
          {SPARKS.map((p, j) => (
            <circle
              key={j}
              className="sh-spark"
              cx={HIT_X}
              cy={s.y}
              r={2.5}
              fill="var(--orange)"
              style={{ animationDelay: `${s.delay}s`, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px` }}
            />
          ))}
        </g>
      ))}

      <path className="sh-ring" d={SHIELD} fill="none" stroke="var(--blue)" strokeWidth="3" style={{ animationDelay: '0.74s' }} />
      <g className="sh-body" style={{ animationDelay: '0.74s' }}>
        <path d={SHIELD} fill="url(#sh-fill)" filter="url(#sh-shadow)" />
        <path d={SHIELD} fill="url(#sh-gloss)" />
        <path d="M214 106l18 18 34-38" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
