// Address-poisoning detection: a receiver that is *almost* an account the vault
// already trusts is far more likely an attack than a coincidence.

const CONFUSABLES: Record<string, string> = {
  '0': 'o', '1': 'l', i: 'l', '|': 'l', '5': 's', '$': 's', '3': 'e', '4': 'a', '@': 'a', '7': 't', '8': 'b', '9': 'g',
  // Cyrillic / Greek look-alikes that survive copy-paste into account-shaped strings
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'l', 'ο': 'o', 'ν': 'v',
};

/** Visual skeleton: lower-case, confusable characters folded, separators dropped. */
export function skeleton(id: string): string {
  return [...id.toLowerCase()]
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join('')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[-_]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const IMPLICIT = /^[0-9a-f]{64}$/;

/** Returns the trusted account `receiver` imitates, if any. */
export function findLookalike(receiver: string, trusted: Iterable<string>): string | undefined {
  for (const t of trusted) {
    if (t === receiver) return undefined; // exact match is the trusted account itself
  }
  for (const t of trusted) {
    if (IMPLICIT.test(receiver) && IMPLICIT.test(t)) {
      // poisoning copies the first/last characters people actually check
      if (receiver.slice(0, 4) === t.slice(0, 4) && receiver.slice(-4) === t.slice(-4)) return t;
      continue;
    }
    if (skeleton(receiver) === skeleton(t)) return t;
    const [ra, ta] = [receiver.split('.')[0], t.split('.')[0]];
    const sameSuffix = receiver.slice(ra.length) === t.slice(ta.length);
    if (sameSuffix && ta.length >= 5 && levenshtein(ra, ta) <= (ta.length >= 10 ? 2 : 1)) return t;
  }
  return undefined;
}
