import { NATIVE, extractMovements, netChanges } from './transfers.ts';
import { buildTree, decodeBase64Json, walk } from './tree.ts';
import type { RawTx, ReceiptNode, TxReport, Verdict } from './types.ts';

export interface AnalyzeOptions {
  /** Token decimals for display, keyed by token account id. NEAR is always 24. */
  decimals?: Record<string, number>;
}

const KNOWN_DECIMALS: Record<string, number> = { [NATIVE]: 24, 'wrap.near': 24, 'wrap.testnet': 24 };

export function analyzeTx(tx: RawTx, opts: AnalyzeOptions = {}): TxReport {
  const root = buildTree(tx);
  const failures: TxReport['failures'] = [];
  const events: TxReport['events'] = [];
  let gas = tx.transaction_outcome.outcome.gas_burnt / 1e12;
  walk(root, (n) => {
    gas += n.gasTgas;
    events.push(...n.events);
    if (n.error) failures.push({ receiptId: n.id, executor: n.receiver, error: n.error });
  });

  const movements = extractMovements(root);
  const net = netChanges(movements);
  const returnValue = 'SuccessValue' in tx.status ? decodeBase64Json(tx.status.SuccessValue) : undefined;
  const rejection = countersignRejection(returnValue, events);

  let verdict: Verdict = 'success';
  if ('Failure' in tx.status) verdict = 'failed';
  else if (rejection) verdict = 'rejected';
  else if (failures.length > 0) verdict = 'partial';

  const decimals = { ...KNOWN_DECIMALS, ...opts.decimals };
  const funds = describeNet(net, decimals);
  const first = failures[0];
  const headline = {
    success: `Succeeded. ${funds}`,
    rejected: `Stopped by the Countersign vault: ${rejection?.replaceAll('_', ' ')}. No funds moved.`,
    partial: `Partly failed at ${first?.executor}: ${first?.error.title}. ${hadRefund(root, events) ? 'Funds were returned. ' : ''}${funds}`,
    failed: `Failed at ${first?.executor}: ${first?.error.title}. ${funds}`,
  }[verdict];

  return {
    hash: tx.transaction.hash,
    signer: tx.transaction.signer_id,
    receiver: tx.transaction.receiver_id,
    verdict,
    headline,
    returnValue,
    root,
    failures,
    movements,
    net,
    events,
    gasTgas: Math.round(gas * 100) / 100,
  };
}

function countersignRejection(returnValue: unknown, events: TxReport['events']): string | undefined {
  const rv = returnValue as { status?: string; reason?: string } | undefined;
  if (rv?.status === 'rejected' && events.some((e) => e.standard === 'countersign' && e.event === 'action_rejected')) {
    return rv.reason ?? 'rejected';
  }
  return undefined;
}

function hadRefund(root: ReceiptNode, events: TxReport['events']): boolean {
  let found = false;
  walk(root, (n) => {
    if (n.role === 'deposit_refund' || n.logs.some((l) => l.startsWith('Refund '))) found = true;
  });
  return found || events.some((e) => e.standard === 'countersign' && (e.data as any[])?.some?.((d) => d?.refunded && d.refunded !== '0'));
}

export function formatAmount(amount: string, decimals?: number): string {
  if (decimals === undefined) return amount;
  const neg = amount.startsWith('-');
  const digits = (neg ? amount.slice(1) : amount).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '').slice(0, 6);
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

function describeNet(net: TxReport['net'], decimals: Record<string, number>): string {
  const gains = Object.entries(net).flatMap(([account, byAsset]) =>
    Object.entries(byAsset)
      .filter(([, v]) => !v.startsWith('-'))
      .map(([asset, v]) => `${account} received ${formatAmount(v, decimals[asset])} ${asset}`),
  );
  return gains.length ? `${gains.join('; ')}.` : 'No funds changed hands.';
}

/** Plain-text rendering for CLIs and logs. */
export function formatReport(report: TxReport, opts: AnalyzeOptions & { showGasRefunds?: boolean } = {}): string {
  const decimals = { ...KNOWN_DECIMALS, ...opts.decimals };
  const lines = [`${report.verdict.toUpperCase()}: ${report.headline}`, ''];
  walk(report.root, (n, depth) => {
    if (n.role === 'gas_refund' && !opts.showGasRefunds) return;
    const what =
      n.role === 'deposit_refund'
        ? 'refund of failed deposit'
        : n.role === 'gas_refund'
          ? 'gas refund'
          : n.actions.map((a) => (a.kind === 'function_call' ? a.method : a.kind === 'transfer' ? `transfer ${formatAmount(a.deposit, 24)} NEAR` : a.type)).join(', ') || '(receipt)';
    const mark = n.ok ? 'ok ' : 'ERR';
    lines.push(`${'  '.repeat(depth)}[${mark}] ${n.receiver}  ${what}${n.error ? `  — ${n.error.detail}` : ''}`);
    if (n.error?.hint) lines.push(`${'  '.repeat(depth)}      hint: ${n.error.hint}`);
  });
  if (report.movements.length) {
    lines.push('', 'Funds moved:');
    for (const m of report.movements) {
      const amt = formatAmount(m.amount, decimals[m.asset]);
      lines.push(`  ${m.kind.padEnd(8)} ${amt} ${m.asset}  ${m.from ?? '(minted)'} -> ${m.to ?? '(burned)'}`);
    }
  }
  lines.push('', `Gas: ${report.gasTgas} Tgas`);
  return lines.join('\n');
}
