import { walk } from './tree.ts';
import type { Movement, ReceiptNode } from './types.ts';

export const NATIVE = 'NEAR';

// near-contract-standards 3.x (pre-NEP-297) plain-text logs, still used by wrap.testnet/wrap.near.
const LEGACY: { re: RegExp; make: (m: RegExpMatchArray) => Omit<Movement, 'asset' | 'receiptId'> }[] = [
  { re: /^Transfer (\d+) from (\S+) to (\S+)$/, make: (m) => ({ kind: 'transfer', amount: m[1], from: m[2], to: m[3] }) },
  { re: /^Refund (\d+) from (\S+) to (\S+)$/, make: (m) => ({ kind: 'refund', amount: m[1], from: m[2], to: m[3] }) },
  { re: /^Deposit (\d+) NEAR to (\S+)$/, make: (m) => ({ kind: 'mint', amount: m[1], to: m[2] }) },
  { re: /^Withdraw (\d+) NEAR from (\S+)$/, make: (m) => ({ kind: 'burn', amount: m[1], from: m[2] }) },
];

/**
 * Value that actually moved. Only successful, non-system receipts count: a failed
 * receipt's state changes are reverted even though its logs are still reported,
 * and `system` receipts are the runtime handing back gas or a failed deposit.
 */
export function extractMovements(root: ReceiptNode): Movement[] {
  const out: Movement[] = [];
  walk(root, (n) => {
    if (!n.ok || n.role !== 'call') return;

    for (const a of n.actions) {
      // 1 yoctoNEAR is the NEP-141 "confirm with full-access key" marker, not a payment.
      if (a.kind !== 'other' && BigInt(a.deposit) > 1n) {
        out.push({ asset: NATIVE, kind: 'transfer', from: n.predecessor, to: n.receiver, amount: a.deposit, receiptId: n.id });
      }
    }

    const ftEvents = n.events.filter((e) => e.standard === 'nep141');
    for (const e of ftEvents) {
      for (const d of (Array.isArray(e.data) ? e.data : []) as any[]) {
        if (e.event === 'ft_transfer') out.push({ asset: n.receiver, kind: 'transfer', from: d.old_owner_id, to: d.new_owner_id, amount: d.amount, receiptId: n.id });
        if (e.event === 'ft_mint') out.push({ asset: n.receiver, kind: 'mint', to: d.owner_id, amount: d.amount, receiptId: n.id });
        if (e.event === 'ft_burn') out.push({ asset: n.receiver, kind: 'burn', from: d.owner_id, amount: d.amount, receiptId: n.id });
      }
    }
    if (ftEvents.length > 0) return; // same contract may also print legacy text; don't double count

    for (const log of n.logs) {
      for (const { re, make } of LEGACY) {
        const m = log.match(re);
        if (m) out.push({ asset: n.receiver, receiptId: n.id, ...make(m) });
      }
    }
  });
  return out;
}

export function netChanges(movements: Movement[]): Record<string, Record<string, string>> {
  const net = new Map<string, Map<string, bigint>>();
  const add = (account: string | undefined, asset: string, delta: bigint) => {
    if (!account) return;
    const byAsset = net.get(account) ?? new Map<string, bigint>();
    byAsset.set(asset, (byAsset.get(asset) ?? 0n) + delta);
    net.set(account, byAsset);
  };
  for (const m of movements) {
    const amt = BigInt(m.amount);
    add(m.from, m.asset, -amt);
    add(m.to, m.asset, amt);
  }
  const result: Record<string, Record<string, string>> = {};
  for (const [account, byAsset] of net) {
    for (const [asset, v] of byAsset) {
      if (v !== 0n) (result[account] ??= {})[asset] = v.toString();
    }
  }
  return result;
}
