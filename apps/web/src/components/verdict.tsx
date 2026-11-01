// State is carried by the fill pattern (solid / dither / hatch) and repeated in text,
// so it reads without colour.
type Kind = 'good' | 'mixed' | 'bad';

const KIND: Record<string, Kind> = {
  success: 'good', allow: 'good', executed: 'good', ok: 'good',
  partial: 'mixed', warn: 'mixed', needs_human: 'mixed',
  failed: 'bad', rejected: 'bad', block: 'bad', refused: 'bad',
};

export function Badge({ value, large = false }: { value: string; large?: boolean }) {
  const kind = KIND[value] ?? 'mixed';
  const size = large ? 'text-xl px-3 py-1' : 'text-xs';
  if (kind === 'good') return <span className={`badge badge-solid ${size}`}>{value.toUpperCase()}</span>;
  return (
    <span className={`badge ${kind === 'mixed' ? 'dither-50' : 'hatch'} ${size}`}>
      <span>{value.toUpperCase()}</span>
    </span>
  );
}

export function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`px-frame bg-paper ${className}`}>
      {title && <h2 className="border-b-2 border-ink bg-ink px-3 py-1 font-pixel text-sm text-paper">{title}</h2>}
      <div className="p-4">{children}</div>
    </section>
  );
}
