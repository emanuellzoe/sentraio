'use client';

import { useState } from 'react';
import { Notice, NotConfigured, ProgressBar, postJson, Skeleton, usePoll, XRayLink } from '@/components/ui';
import { Badge, Panel } from '@/components/verdict';
import { useWallet } from '@/components/wallet';

interface Agent {
  id: string;
  frozen: boolean;
  frozenReason: string | null;
  strikes: number;
  maxStrikes: number;
  requireApproval: boolean;
  receivers: string[] | null;
  nonce: number;
  limits: { asset: string; perTx: string; perDay: string; spentToday: string }[];
}

interface VaultState {
  configured: boolean;
  error?: string;
  mode: string;
  vaultId: string;
  owner: string;
  guardian: { account_id: string; public_key: string } | null;
  panicked: boolean;
  codeHash?: string;
  codeHashPinned: string | null;
  balances: { asset: string; display: string }[];
  agents: Agent[];
  agentHint: string;
  agentSimulator: boolean;
}

interface RunResult {
  label: string;
  status: string;
  message: string;
  txHash?: string;
  signer?: string;
}

const num = (display: string) => Number(display.split(' ')[0]);

/** "1.5" NEAR -> yoctoNEAR string, exact (no float math). */
export function toYocto(near: string): string {
  const [whole, frac = ''] = near.trim().split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(frac) || frac.length > 24) throw new Error(`not a NEAR amount: ${near}`);
  return (BigInt(whole || '0') * 10n ** 24n + BigInt(frac.padEnd(24, '0') || '0')).toString();
}

export function Vault() {
  const { data: v, error, reload } = usePoll<VaultState>('/api/vault/state');
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<RunResult[]>([]);
  const [armed, setArmed] = useState(false);
  const [panicSteps, setPanicSteps] = useState<{ step: string; txHash?: string; signer?: string; error?: string }[]>();
  const [lastTx, setLastTx] = useState<{ label: string; txHash?: string; signer?: string; network: string }>();
  const wallet = useWallet();

  if (error && !v) return <Notice title="Could not read the vault" tone="red">{error}</Notice>;
  if (!v) return <Skeleton />;
  if (!v.configured) return <NotConfigured />;
  const local = v.mode === 'local';
  const isOwner = local || wallet.accountId === v.owner;

  // owner methods need 1 yoctoNEAR (full-access confirmation); freeze takes none, deposit takes the amount
  const owner = async (method: string, args: object = {}, deposit = method === 'freeze' ? '0' : '1') => {
    setBusy(method);
    try {
      if (local) {
        const r = await postJson<{ txHash: string; signer: string }>('/api/vault/owner', { method, args, deposit });
        setLastTx({ label: method, txHash: r.txHash, signer: r.signer, network: 'local' });
      } else {
        const txHash = await wallet.call(v.vaultId, method, args, deposit, method === 'trigger_panic' ? 200 : 100);
        setLastTx({ label: method, txHash, signer: wallet.accountId, network: v.mode });
      }
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const run = async (scenario: string) => {
    setBusy(scenario);
    try {
      const r = await postJson<RunResult>('/api/dev/agent', { scenario });
      setLog((l) => [r, ...l].slice(0, 12));
    } catch (e) {
      setLog((l) => [{ label: scenario, status: 'error', message: (e as Error).message }, ...l]);
    } finally {
      setBusy(undefined);
      reload();
    }
  };
  const panic = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    if (!local) return owner('trigger_panic');
    setBusy('panic');
    try {
      setPanicSteps((await postJson<{ steps: typeof panicSteps }>('/api/vault/panic')).steps);
    } finally {
      setBusy(undefined);
      reload();
    }
  };
  const codeOk = v.codeHashPinned ? v.codeHash === v.codeHashPinned : undefined;

  return (
    <div className="space-y-6">
      <div className={`ios-card grid gap-3 p-6 md:grid-cols-[1fr_auto] md:items-center ${v.panicked ? 'ring-2 ring-red' : ''}`}>
        <div>
          <p className="text-xs font-semibold uppercase text-label2">Vault</p>
          <p className="font-display text-2xl font-bold break-all">{v.vaultId}</p>
          <p className="text-sm text-label2">Owner {v.owner} · guardian {v.guardian?.account_id ?? 'none'} · {local ? 'local sandbox' : v.mode}</p>
        </div>
        <span>
          {v.panicked ? <span className="pill pill-red pill-lg">✕ Panicked</span> : <span className="pill pill-green pill-lg">● Active</span>}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Balances">
          {v.balances.length === 0 ? <p className="text-label2">Empty.</p> : (
            <ul className="space-y-1">
              {v.balances.map((b) => <li key={b.asset} className="font-display text-4xl font-bold tracking-tight">{b.display}</li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Code integrity">
          <p className="font-mono text-xs text-label2 break-all">{v.codeHash}</p>
          <p className="mt-2 flex items-center gap-2 text-sm">
            <Badge value={codeOk === undefined ? 'warn' : codeOk ? 'ok' : 'block'} />
            {codeOk === undefined ? 'No audited hash pinned.' : codeOk ? 'Matches the audited build.' : 'Does NOT match the audited build.'}
          </p>
        </Panel>
      </div>

      {v.agents.map((a) => (
        <Panel key={a.id} title="Agent">
          <p className="mb-4 font-semibold break-all">{a.id}</p>
          <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
            <div className="space-y-3">
              {a.limits.map((l) => (
                <div key={l.asset}>
                  <p className="text-xs font-semibold uppercase text-label2">{l.asset} · spent today</p>
                  <p className="flex flex-wrap items-center gap-3">
                    <ProgressBar value={num(l.spentToday)} max={num(l.perDay)} /> <span>{l.spentToday} / {l.perDay}</span>
                  </p>
                  <p className="text-xs text-label2">Max {l.perTx} per transaction</p>
                </div>
              ))}
              <p className="text-sm text-label2">
                Receivers: {a.receivers ? a.receivers.join(', ') : 'any (Clearance decides)'} · approval {a.requireApproval ? 'required' : 'not required'}
              </p>
            </div>
            <div className="space-y-3">
              <p className="flex items-center gap-2">
                <Badge value={a.frozen ? 'block' : 'ok'} /> <span className="font-semibold">{a.frozen ? 'Frozen' : 'Can act'}</span>
              </p>
              {a.frozenReason && <p className="text-sm text-label2">{a.frozenReason}</p>}
              <p className="flex items-center gap-3 text-sm">
                <span className="text-label2">Strikes</span> <ProgressBar value={a.strikes} max={a.maxStrikes || 1} /> {a.strikes}/{a.maxStrikes || '∞'}
              </p>
              {isOwner && (
                a.frozen
                  ? <button className="ios-btn ios-btn-tinted" disabled={!!busy} onClick={() => owner('unfreeze', { agent_id: a.id })}>{busy === 'unfreeze' ? '…' : 'Unfreeze'}</button>
                  : <button className="ios-btn ios-btn-danger-tinted" disabled={!!busy} onClick={() => owner('freeze', { agent_id: a.id, reason: 'frozen by owner from dashboard' })}>{busy === 'freeze' ? '…' : 'Freeze'}</button>
              )}
            </div>
          </div>
        </Panel>
      ))}

      {(local || v.agentSimulator) && (
        <Panel title={`Play the agent (${local ? 'local sandbox' : v.mode})`}>
          <p className="mb-4 text-sm text-label2">Each button is something the AI agent tries to do. Watch what gets through.</p>
          <div className="flex flex-wrap gap-3">
            {[['honest', 'Honest invoice'], ['injected', 'Prompt-injected invoice'], ['bypass', 'Bypass the guard'], ['new_vendor', 'New vendor']].map(([k, label]) => (
              <button key={k} className="ios-btn ios-btn-tinted" disabled={!!busy} onClick={() => run(k)}>{busy === k ? 'Running…' : label}</button>
            ))}
          </div>
          {log.length > 0 && (
            <ol className="fade-in mt-5 overflow-hidden rounded-xl bg-fill/40 [&>li+li]:border-t-[0.5px] [&>li+li]:border-sep">
              {log.map((r, i) => (
                <li key={i} className="space-y-1 px-4 py-3">
                  <p className="flex flex-wrap items-center gap-2"><Badge value={r.status === 'executed' ? 'executed' : r.status === 'needs_human' ? 'needs_human' : 'refused'} /> <span className="text-sm font-semibold">{r.label}</span></p>
                  <p className="text-sm text-label2">{r.message}</p>
                  <XRayLink tx={r.txHash} network={v.mode} />
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      <OwnerControls
        v={v}
        isOwner={isOwner}
        local={local}
        busy={busy}
        connected={wallet.accountId}
        onSubmit={owner}
        lastTx={lastTx}
      />

      <section>
        <h2 className="section-header">Emergency</h2>
        <div className="ios-card space-y-3 p-6">
          <h3 className="flex items-center gap-2 font-display text-2xl font-bold text-red"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-red text-base text-white">!</span>Panic</h3>
          <p className="text-sm text-label2">
            Freezes every agent, sends every balance back to the owner, and deletes the agent&apos;s access key.
            One transaction each, constant gas however many agents there are.
          </p>
          <div className="flex flex-wrap gap-3">
            {isOwner ? (
              <button className={`ios-btn ${armed ? 'ios-btn-danger' : 'ios-btn-danger-tinted'}`} disabled={!!busy || v.panicked} onClick={panic} onBlur={() => setArmed(false)}>
                {busy === 'panic' || busy === 'trigger_panic' ? 'Stopping…' : armed ? 'Tap again to confirm' : 'Panic'}
              </button>
            ) : (
              <p className="text-sm text-label2">Connect the owner wallet ({v.owner}) to use Panic.</p>
            )}
            {isOwner && v.panicked && (
              <button className="ios-btn ios-btn-plain" disabled={!!busy} onClick={() => owner('clear_panic')}>{busy === 'clear_panic' ? '…' : 'Clear panic'}</button>
            )}
          </div>
          {!local && isOwner && (
            <p className="text-xs text-label3">On {v.mode} the wallet signs trigger_panic. Deleting the agent&apos;s key needs the agent account&apos;s full-access key, held by whoever created the agent.</p>
          )}
          {panicSteps && (
            <ul className="space-y-1 text-sm">
              {panicSteps.map((s, i) => (
                <li key={i}>
                  {s.error ? '✗' : '✓'} {s.step} {s.error && `— ${s.error}`} <XRayLink tx={s.txHash} signer={s.signer} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function OwnerControls({ v, isOwner, local, busy, connected, onSubmit, lastTx }: {
  v: VaultState;
  isOwner: boolean;
  local: boolean;
  busy?: string;
  connected?: string;
  onSubmit: (method: string, args?: object, deposit?: string) => Promise<void>;
  lastTx?: { label: string; txHash?: string; signer?: string; network: string };
}) {
  const [m, setM] = useState({ agent: v.agents[0]?.id ?? v.agentHint, perTx: '0.5', perDay: '1', receivers: '', approval: true, strikes: '3' });
  const [amount, setAmount] = useState('1');
  if (!isOwner) {
    return (
      <Panel title="Owner controls">
        <p className="text-sm">
          {connected ? `Connected as ${connected}, but the owner of this vault is ${v.owner}.` : `Connect the owner wallet (${v.owner}) to set mandates, deposit, freeze or panic.`}
        </p>
      </Panel>
    );
  }
  const setMandate = () => {
    const receivers = m.receivers.split(',').map((r) => r.trim()).filter(Boolean);
    return onSubmit('set_mandate', {
      agent_id: m.agent.trim(),
      mandate: {
        limits: [{ asset: 'NEAR', per_tx: toYocto(m.perTx), per_day: toYocto(m.perDay) }],
        allowed_receivers: receivers.length ? receivers : null,
        expires_at_ns: null,
        require_approval: m.approval,
        max_strikes: Number(m.strikes),
      },
    });
  };
  return (
    <Panel title={`Owner controls${local ? ' (dev key, local sandbox)' : ` (signed by ${connected})`}`}>
      <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setMandate(); }}>
          <p className="text-xs font-semibold uppercase text-label2">Mandate (NEAR)</p>
          <label className="grid gap-1 text-sm">Agent account<input className="ios-input" value={m.agent} onChange={(e) => setM({ ...m, agent: e.target.value })} required spellCheck={false} /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1 text-sm">Max per tx<input className="ios-input" value={m.perTx} onChange={(e) => setM({ ...m, perTx: e.target.value })} required /></label>
            <label className="grid gap-1 text-sm">Max per day<input className="ios-input" value={m.perDay} onChange={(e) => setM({ ...m, perDay: e.target.value })} required /></label>
            <label className="grid gap-1 text-sm">Max strikes<input className="ios-input" type="number" min="0" value={m.strikes} onChange={(e) => setM({ ...m, strikes: e.target.value })} required /></label>
          </div>
          <label className="grid gap-1 text-sm">Allowed receivers (comma-separated, empty = any, Clearance decides)<input className="ios-input" value={m.receivers} onChange={(e) => setM({ ...m, receivers: e.target.value })} spellCheck={false} /></label>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-fill/60 px-3 py-2 text-sm">Require a Clearance approval for every payment<input type="checkbox" className="ios-switch" checked={m.approval} onChange={(e) => setM({ ...m, approval: e.target.checked })} /></label>
          <button className="ios-btn" disabled={!!busy}>{busy === 'set_mandate' ? 'Signing…' : 'Set mandate'}</button>
        </form>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase text-label2">Fund the vault</p>
          <label className="grid gap-1 text-sm">Amount (NEAR)<input className="ios-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <div className="flex flex-wrap gap-3">
            <button className="ios-btn" disabled={!!busy} onClick={() => onSubmit('deposit_near', {}, toYocto(amount))}>{busy === 'deposit_near' ? 'Signing…' : 'Deposit'}</button>
            <button className="ios-btn ios-btn-tinted" disabled={!!busy} onClick={() => onSubmit('withdraw', { asset: 'NEAR', amount: toYocto(amount) })}>{busy === 'withdraw' ? 'Signing…' : 'Withdraw'}</button>
          </div>
          {lastTx && (
            <p className="text-sm">
              ✓ {lastTx.label} sent <XRayLink tx={lastTx.txHash} signer={lastTx.signer} network={lastTx.network} />
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
