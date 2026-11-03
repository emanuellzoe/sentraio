import { Badge } from './verdict';

export interface UiSignal {
  id: string;
  level: 'ok' | 'warn' | 'block';
  title: string;
  detail: string;
  source: string;
}

/** Worst first, so the reason for the verdict is on top. Rendered as an inset grouped list. */
export function SignalList({ signals }: { signals: UiSignal[] }) {
  const rank = { block: 0, warn: 1, ok: 2 };
  return (
    <ul className="overflow-hidden rounded-xl bg-fill/40 [&>li+li]:border-t-[0.5px] [&>li+li]:border-sep">
      {[...signals].sort((a, b) => rank[a.level] - rank[b.level]).map((s, i) => (
        <li key={`${s.id}-${i}`} className="flex items-start gap-3 px-4 py-3">
          <Badge value={s.level} />
          <div className="min-w-0">
            <p className="text-sm font-medium">{s.title}</p>
            {s.level !== 'ok' && <p className="text-sm text-label2">{s.detail}</p>}
            <p className="text-xs text-label3">{s.source}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
