// Status as an iOS-style tinted pill: colour plus an icon and the word, so it never
// relies on colour alone.
type Kind = 'good' | 'mixed' | 'bad' | 'neutral';

const KIND: Record<string, Kind> = {
  success: 'good', allow: 'good', executed: 'good', ok: 'good', approved: 'good',
  partial: 'mixed', warn: 'mixed', needs_human: 'mixed',
  failed: 'bad', rejected: 'bad', block: 'bad', refused: 'bad', vault_rejected: 'bad', expired: 'bad',
};
const STYLE: Record<Kind, { cls: string; icon: string }> = {
  good: { cls: 'pill-green', icon: '✓' },
  mixed: { cls: 'pill-orange', icon: '!' },
  bad: { cls: 'pill-red', icon: '✕' },
  neutral: { cls: 'pill-gray', icon: '•' },
};
const LABEL: Record<string, string> = { needs_human: 'Needs human', vault_rejected: 'Vault rejected' };

export function Badge({ value, large = false }: { value: string; large?: boolean }) {
  const s = STYLE[KIND[value] ?? 'neutral'];
  const text = LABEL[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <span className={`pill ${s.cls} ${large ? 'pill-lg' : ''}`}>
      <span aria-hidden>{s.icon}</span>
      {text}
    </span>
  );
}

/** Settings-style section: small uppercase header above a rounded card. */
export function Panel({ title, children, className = '', footer }: { title?: string; children: React.ReactNode; className?: string; footer?: string }) {
  return (
    <section className={className}>
      {title && <h2 className="section-header">{title}</h2>}
      <div className="ios-card p-5">{children}</div>
      {footer && <p className="px-4 pt-2 text-xs text-label2">{footer}</p>}
    </section>
  );
}
