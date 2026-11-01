import { Badge } from './verdict';

export interface UiSignal {
  id: string;
  level: 'ok' | 'warn' | 'block';
  title: string;
  detail: string;
  source: string;
}

/** Worst first, so the reason for the verdict is on top. */
export function SignalList({ signals }: { signals: UiSignal[] }) {
  const rank = { block: 0, warn: 1, ok: 2 };
  return (
    <ul className="space-y-2">
      {[...signals].sort((a, b) => rank[a.level] - rank[b.level]).map((s, i) => (
        <li key={`${s.id}-${i}`} className="grid grid-cols-[4.5rem_1fr] items-start gap-3">
          <Badge value={s.level} />
          <div>
            <p className="text-sm font-semibold">{s.title}</p>
            {s.level !== 'ok' && <p className="text-sm">{s.detail}</p>}
            <p className="text-xs opacity-70">source: {s.source}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
