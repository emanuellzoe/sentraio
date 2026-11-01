import { analyzeTx, fetchFtDecimals, fetchTx, formatAmount, RpcError } from '@sentineli/core';
import type { Network, ReceiptNode } from '@sentineli/core';

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface UiNode {
  id: string;
  receiver: string;
  role: ReceiptNode['role'];
  ok: boolean;
  label: string;
  gasTgas: number;
  error?: { code: string; title: string; detail: string; hint?: string };
  children: UiNode[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get('tx')?.trim() ?? '';
  const signer = url.searchParams.get('signer')?.trim().toLowerCase() ?? '';
  const network = (url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'testnet') as Network;
  if (!HASH.test(hash)) return Response.json({ error: 'That does not look like a NEAR transaction hash.' }, { status: 400 });
  if (!ACCOUNT.test(signer) || signer.length < 2 || signer.length > 64) return Response.json({ error: 'Signer must be a NEAR account id.' }, { status: 400 });

  try {
    const tx = await fetchTx({ hash, sender: signer, network });
    const tokens = analyzeTx(tx).movements.map((m) => m.asset).filter((a) => a !== 'NEAR');
    const decimals = await fetchFtDecimals(tokens, { network });
    const r = analyzeTx(tx, { decimals });
    const dec = (asset: string) => (asset === 'NEAR' ? 24 : decimals[asset]);

    const toUi = (n: ReceiptNode): UiNode => ({
      id: n.id,
      receiver: n.receiver,
      role: n.role,
      ok: n.ok,
      gasTgas: Math.round(n.gasTgas * 100) / 100,
      label:
        n.role === 'deposit_refund' ? 'refund of failed deposit'
        : n.role === 'gas_refund' ? 'gas refund'
        : n.actions.map((a) => (a.kind === 'function_call' ? `${a.method}()` : a.kind === 'transfer' ? `transfer ${formatAmount(a.deposit, 24)} NEAR` : a.type)).join(' + ') || 'receipt',
      error: n.error && { code: n.error.code, title: n.error.title, detail: n.error.detail, hint: n.error.hint },
      children: n.children.map(toUi),
    });

    return Response.json({
      network,
      hash: r.hash,
      signer: r.signer,
      receiver: r.receiver,
      verdict: r.verdict,
      headline: r.headline,
      gasTgas: r.gasTgas,
      failures: r.failures.map((f) => ({ executor: f.executor, code: f.error.code, title: f.error.title, detail: f.error.detail, hint: f.error.hint })),
      movements: r.movements.map((m) => ({ ...m, display: `${formatAmount(m.amount, dec(m.asset))} ${m.asset}` })),
      net: Object.entries(r.net).map(([account, byAsset]) => ({
        account,
        changes: Object.entries(byAsset).map(([asset, v]) => ({ asset, display: `${v.startsWith('-') ? '' : '+'}${formatAmount(v, dec(asset))}` })),
      })),
      events: r.events.map((e) => ({ standard: e.standard, event: e.event })),
      tree: toUi(r.root),
    });
  } catch (e) {
    const code = e instanceof RpcError ? e.code : 'ERROR';
    const message = code === 'UNKNOWN_TRANSACTION'
      ? 'Transaction not found. Check the hash, the signer account and the network.'
      : (e as Error).message;
    return Response.json({ error: message, code }, { status: code === 'UNKNOWN_TRANSACTION' ? 404 : 502 });
  }
}
