'use client';

import { useState } from 'react';
import { SignalList } from '@/components/signals';
import type { UiSignal } from '@/components/signals';
import { Notice, postJson } from '@/components/ui';
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
            <span className="text-xs font-medium text-label2">Pay to</span>
            <input className="ios-input" value={form.receiver} onChange={(e) => setForm({ ...form, receiver: e.target.value })} required spellCheck={false} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-label2">Amount (NEAR)</span>
            <input className="ios-input" type="number" step="0.000001" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </label>
          {!LOCAL && (
            <>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-label2">Vault</span>
                <input className="ios-input" value={form.vaultId} onChange={(e) => setForm({ ...form, vaultId: e.target.value })} placeholder="vault.you.testnet" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-label2">Agent</span>
                <input className="ios-input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} placeholder="agent.you.testnet" />
              </label>
            </>
          )}
          <button className="ios-btn" disabled={state.loading}>{state.loading ? 'Checking…' : 'Check'}</button>
          {PRESETS.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-sm">
              <span className="text-label2">Try:</span>
              {PRESETS.map((p) => (
                <button key={p.label} type="button" className="pill pill-blue hover:opacity-80" onClick={() => check({ ...form, receiver: p.receiver, amount: p.amount })}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-label3">Dry run: nothing is signed or sent.</p>
        </form>
      </Panel>

      <div>
        {state.loading && <div className="ios-card flex items-center gap-3 p-6 text-label2"><span className="spinner" /> Asking the chain…</div>}
        {state.error && <Notice title="Check failed" tone="red">{state.error}</Notice>}
        {state.decision && (
          <Panel title="Verdict">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Badge value={state.decision.verdict} large />
              <p className="font-medium">{state.decision.summary}</p>
            </div>
            <SignalList signals={state.decision.signals} />
          </Panel>
        )}
      </div>
    </div>
  );
}
