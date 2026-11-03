'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { UiNode } from '../api/xray/route';
import { Badge, Panel } from '@/components/verdict';

interface Report {
  network: string;
  hash: string;
  signer: string;
  receiver: string;
  verdict: string;
  headline: string;
  gasTgas: number;
  failures: { executor: string; code: string; title: string; detail: string; hint?: string }[];
  movements: { kind: string; from?: string; to?: string; display: string; receiptId: string }[];
  net: { account: string; changes: { asset: string; display: string }[] }[];
  events: { standard: string; event: string }[];
  tree: UiNode;
}

const EXAMPLES = [
  { label: 'Vault blocks a bypass (Sentraio)', tx: 'HvabZkxqiJBpJSvWCzr1VSkGPfC4vYq2PaybH4iiqc52', network: 'testnet' },
  { label: 'Ref swap NEAR→USDT', tx: 'AjSDQJSUrrkBmuAYVjMkgm6J7ZwJuqvMNQXua1vHe4Qo', network: 'testnet' },
  { label: 'Failed: receiver not registered', tx: 'AoxsGoWSo4iefhHYg8NM6U3GachV3VEsG4JW1JpvwdrM', network: 'testnet' },
  { label: 'Failed: zero amount', tx: '5ToKYFoveoWPjWAKSqDgFmH2YTFgH2X2JLQbmJcTnF8P', network: 'testnet' },
];

const HASH = /[1-9A-HJ-NP-Za-km-z]{43,44}/g;

/** Lets long account ids wrap only after a dot (zero-width space), never mid-name. */
const wrapAtDots = (id: string) => id.replaceAll('.', '.\u200b');

/** Accepts a bare hash or an explorer link; the link's host also tells the network. */
export function parseTxInput(input: string, fallback: string): { tx: string; network: string } | undefined {
  const tx = input.trim().match(HASH)?.at(-1);
  if (!tx) return undefined;
  let network = fallback;
  try {
    const host = new URL(input.trim()).host;
    network = host.includes('testnet') ? 'testnet' : 'mainnet';
  } catch {
    /* not a URL: keep the selected network */
  }
  return { tx, network };
}

export function XRay() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [form, setForm] = useState({ tx: params.get('tx') ?? '', network: params.get('network') ?? 'testnet' });
  const [inputError, setInputError] = useState<string>();
  const [state, setState] = useState<{ loading: boolean; error?: string; report?: Report }>({ loading: false });
  const [showGas, setShowGas] = useState(false);

  // the URL is the source of truth, so a report can be shared as a link
  const query = params.toString();
  useEffect(() => {
    if (!params.get('tx')) return;
    let cancelled = false;
    setState({ loading: true });
    fetch(`/api/xray?${query}`)
      .then(async (res) => {
        const body = await res.json();
        if (!cancelled) setState(res.ok ? { loading: false, report: body } : { loading: false, error: body.error });
      })
      .catch((e: Error) => !cancelled && setState({ loading: false, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [query, params]);

  const submit = (f = form) => {
    const parsed = parseTxInput(f.tx, f.network);
    if (!parsed) return setInputError('Paste a transaction hash or an explorer link (nearblocks, explorer.near.org…).');
    setInputError(undefined);
    setForm(parsed);
    router.push(`${pathname}?${new URLSearchParams(parsed).toString()}`);
  };

  const r = state.report;
  return (
    <div className="space-y-8">
      <form
        className="px-frame grid gap-3 bg-paper p-4 md:grid-cols-[1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-pixel text-xs">Transaction hash or explorer link</span>
          <input
            className="px-input"
            value={form.tx}
            onChange={(e) => setForm({ ...form, tx: e.target.value })}
            onPaste={(e) => {
              const parsed = parseTxInput(e.clipboardData.getData('text'), form.network);
              if (parsed) {
                e.preventDefault();
                submit(parsed); // pasting is enough: no extra click
              }
            }}
            placeholder="8SrPbuN5…  or  https://testnet.nearblocks.io/txns/…"
            required
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-pixel text-xs">Network</span>
          <select className="px-input" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })}>
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet</option>
            {process.env.NEXT_PUBLIC_NETWORK === 'local' && <option value="local">local sandbox</option>}
          </select>
        </label>
        <button className="px-btn self-end" disabled={state.loading}>
          {state.loading ? 'Reading…' : 'Explain'}
        </button>
        {inputError && <p className="text-sm md:col-span-3">{inputError}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs md:col-span-3">
          <span className="font-pixel">Try:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex.tx} type="button" className="underline decoration-2 underline-offset-4 hover:bg-ink hover:text-paper" onClick={() => submit({ tx: ex.tx, network: ex.network })}>
              {ex.label}
            </button>
          ))}
        </div>
      </form>

      {state.loading && (
        <div className="dither-25 px-frame p-6">
          <p className="inline-block bg-paper px-2 font-pixel">Fetching receipts<span className="cursor" /></p>
        </div>
      )}
      {state.error && (
        <div className="hatch px-frame p-4">
          <p className="inline-block bg-paper px-2">{state.error}</p>
        </div>
      )}

      {r && (
        <div className="space-y-6">
          <div className="px-frame grid gap-3 bg-paper p-5 md:grid-cols-[auto_1fr] md:items-center">
            <Badge value={r.verdict} large />
            <p className="text-lg leading-snug">{r.headline}</p>
            <p className="text-xs md:col-span-2">
              {r.network} · {r.signer} → {r.receiver} · {r.gasTgas} Tgas
              {r.network !== 'local' && (
                <>
                  {' · '}
                  <a className="underline" href={`https://${r.network === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${r.hash}`} target="_blank" rel="noreferrer">
                    explorer ↗
                  </a>
                </>
              )}
            </p>
          </div>

          {r.failures.length > 0 && (
            <Panel title={`What went wrong (${r.failures.length})`}>
              <ul className="space-y-4">
                {r.failures.map((f, i) => (
                  <li key={i} className="border-l-4 border-ink pl-3">
                    <p className="font-pixel text-sm">{f.title}</p>
                    <p className="text-sm">{f.detail}</p>
                    {f.hint && <p className="mt-1 text-sm"><span className="font-pixel text-xs">Fix → </span>{f.hint}</p>}
                    <p className="mt-1 text-xs opacity-70">{f.code} at {f.executor}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="Receipt tree">
              <label className="mb-3 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={showGas} onChange={(e) => setShowGas(e.target.checked)} /> show gas refunds
              </label>
              <Tree node={r.tree} showGas={showGas} />
            </Panel>

            <div className="space-y-6">
              <Panel title="Where the funds are now">
                {r.net.length === 0 ? (
                  <p className="text-sm">No funds changed hands.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {r.net.flatMap((n) => n.changes.map((c) => (
                        <tr key={n.account + c.asset} className="border-b border-ink last:border-0">
                          <td className="py-1 pr-2">{wrapAtDots(n.account)}</td>
                          <td className="py-1 text-right font-semibold whitespace-nowrap">{c.display}</td>
                          <td className="py-1 pl-2 text-xs">{wrapAtDots(c.asset)}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                )}
              </Panel>
              <Panel title="Movements">
                {r.movements.length === 0 ? (
                  <p className="text-sm">None. Logs from failed receipts are ignored on purpose: their state was reverted.</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {r.movements.map((m, i) => (
                      <li key={i}>
                        <span className="font-pixel text-xs">{m.kind}</span> {m.display}
                        <br />
                        <span className="text-xs break-all">{m.from ?? '(minted)'} → {m.to ?? '(burned)'}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tree({ node, showGas, depth = 0 }: { node: UiNode; showGas: boolean; depth?: number }) {
  if (node.role === 'gas_refund' && !showGas) return null;
  return (
    <div className={depth ? 'ml-4 border-l-2 border-ink pl-3' : ''}>
      <div className={`my-1 flex flex-wrap items-baseline gap-2 py-1 ${node.ok ? '' : 'hatch px-1'}`}>
        <span className={node.ok ? '' : 'bg-paper px-1'}>
          <Badge value={node.ok ? 'ok' : 'failed'} />
        </span>
        <span className={`text-sm break-all ${node.ok ? '' : 'bg-paper px-1'}`}>
          <b>{node.receiver}</b> {node.label}
        </span>
        <span className={`text-xs ${node.ok ? '' : 'bg-paper px-1'}`}>{node.gasTgas} Tgas</span>
      </div>
      {node.error && <p className="mb-1 ml-1 text-xs">↳ {node.error.detail}</p>}
      {node.children.map((c) => (
        <Tree key={c.id} node={c} showGas={showGas} depth={depth + 1} />
      ))}
    </div>
  );
}
