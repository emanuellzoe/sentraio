'use client';

import { useState } from 'react';
import { SignalList } from '@/components/signals';
import type { UiSignal } from '@/components/signals';
import { postJson } from '@/components/ui';
import { Badge, Panel } from '@/components/verdict';

interface Decision {
  verdict: string;
  summary: string;
  signals: UiSignal[];
}

const LOCAL = process.env.NEXT_PUBLIC_NETWORK === 'local';
const PRESETS = LOCAL
  ? [
      { label: 'Known shop', receiver: 'shop-payments.test.near', amount: '2' },
      { label: 'Look-alike', receiver: 'shop-payrnents.test.near', amount: '5' },
      { label: 'New vendor', receiver: 'coffee-corner.test.near', amount: '1.5' },
      { label: 'Does not exist', receiver: 'shop-paymnets.test.near', amount: '1' },
      { label: 'Over the limit', receiver: 'shop-payments.test.near', amount: '50' },
    ]
  : [];

const yocto = (near: string) => (BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n).toString();

export function Playground() {
  const [form, setForm] = useState({ receiver: PRESETS[1]?.receiver ?? '', amount: PRESETS[1]?.amount ?? '1', vaultId: '', agentId: '' });
  const [state, setState] = useState<{ loading?: boolean; error?: string; decision?: Decision }>({});

  const check = async (f = form) => {
    setForm(f);
    setState({ loading: true });
    try {
      const decision = await postJson<Decision>('/api/clearance', {
        vaultId: f.vaultId || undefined,
        agentId: f.agentId || undefined,
        action: { type: 'near_transfer', receiver_id: f.receiver.trim(), amount: yocto(f.amount) },
      });
      setState({ decision });
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <Panel title="Planned agent action">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); check(); }}>
          <label className="grid gap-1">
            <span className="font-pixel text-xs">Pay to</span>
            <input className="px-input" value={form.receiver} onChange={(e) => setForm({ ...form, receiver: e.target.value })} required spellCheck={false} />
          </label>
          <label className="grid gap-1">
            <span className="font-pixel text-xs">Amount (NEAR)</span>
            <input className="px-input" type="number" step="0.000001" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </label>
          {!LOCAL && (
            <>
              <label className="grid gap-1">
                <span className="font-pixel text-xs">Vault</span>
                <input className="px-input" value={form.vaultId} onChange={(e) => setForm({ ...form, vaultId: e.target.value })} placeholder="vault.you.testnet" />
              </label>
              <label className="grid gap-1">
                <span className="font-pixel text-xs">Agent</span>
                <input className="px-input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} placeholder="agent.you.testnet" />
              </label>
            </>
          )}
          <button className="px-btn" disabled={state.loading}>{state.loading ? 'Checking…' : 'Check'}</button>
          {PRESETS.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 text-xs">
              <span className="font-pixel">Try:</span>
              {PRESETS.map((p) => (
                <button key={p.label} type="button" className="underline decoration-2 underline-offset-4 hover:bg-ink hover:text-paper" onClick={() => check({ ...form, receiver: p.receiver, amount: p.amount })}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs">Dry run: nothing is signed or sent.</p>
        </form>
      </Panel>

      <div>
        {state.loading && <div className="dither-25 px-frame p-6"><p className="inline-block bg-paper px-2 font-pixel">Asking the chain<span className="cursor" /></p></div>}
        {state.error && <div className="hatch px-frame p-4"><p className="inline-block bg-paper px-2">{state.error}</p></div>}
        {state.decision && (
          <Panel title="Verdict">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Badge value={state.decision.verdict} large />
              <p>{state.decision.summary}</p>
            </div>
            <SignalList signals={state.decision.signals} />
          </Panel>
        )}
      </div>
    </div>
  );
}
