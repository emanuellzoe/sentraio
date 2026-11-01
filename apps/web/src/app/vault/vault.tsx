'use client';

import { useState } from 'react';
import { FailLensLink, NotConfigured, PixelBar, postJson, usePoll } from '@/components/ui';
import { Badge, Panel } from '@/components/verdict';

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
}

interface RunResult {
  label: string;
  status: string;
  message: string;
  txHash?: string;
  signer?: string;
}

const num = (display: string) => Number(display.split(' ')[0]);

export function Vault() {
  const { data: v, error, reload } = usePoll<VaultState>('/api/vault/state');
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<RunResult[]>([]);
  const [armed, setArmed] = useState(false);
  const [panicSteps, setPanicSteps] = useState<{ step: string; txHash?: string; signer?: string; error?: string }[]>();

  if (error && !v) return <div className="hatch px-frame p-4"><p className="inline-block bg-paper px-2">{error}</p></div>;
  if (!v) return <div className="dither-25 px-frame h-40" />;
  if (!v.configured) return <NotConfigured />;
  const local = v.mode === 'local';

  const owner = async (method: string, args?: object) => {
    setBusy(method);
    try {
      await postJson('/api/vault/owner', { method, args });
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
      <div className={`px-frame grid gap-3 p-5 md:grid-cols-[1fr_auto] md:items-center ${v.panicked ? 'hatch' : 'bg-paper'}`}>
        <div className={v.panicked ? 'bg-paper p-2' : ''}>
          <p className="font-pixel text-xs">Vault</p>
          <p className="text-xl break-all">{v.vaultId}</p>
          <p className="text-xs">owner {v.owner} · guardian {v.guardian?.account_id ?? 'none'} · {local ? 'local sandbox' : v.mode}</p>
        </div>
        <span className={v.panicked ? 'bg-paper p-1' : ''}>
          {v.panicked
            ? <span className="badge hatch badge-hatch px-3 py-1 text-xl"><span>PANICKED</span></span>
            : <span className="badge badge-solid px-3 py-1 text-xl">ACTIVE</span>}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Balances">
          {v.balances.length === 0 ? <p className="text-sm">Empty.</p> : (
            <ul className="space-y-1">
              {v.balances.map((b) => <li key={b.asset} className="text-2xl">{b.display}</li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Code integrity">
          <p className="text-xs break-all">running {v.codeHash}</p>
          <p className="mt-2 flex items-center gap-2 text-sm">
            <Badge value={codeOk === undefined ? 'warn' : codeOk ? 'ok' : 'block'} />
            {codeOk === undefined ? 'No audited hash pinned.' : codeOk ? 'Matches the audited build.' : 'Does NOT match the audited build.'}
          </p>
        </Panel>
      </div>

      {v.agents.map((a) => (
        <Panel key={a.id} title={`Agent · ${a.id}`}>
          <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
            <div className="space-y-3">
              {a.limits.map((l) => (
                <div key={l.asset}>
                  <p className="font-pixel text-xs">{l.asset} · spent today</p>
                  <p className="flex flex-wrap items-center gap-3">
                    <PixelBar value={num(l.spentToday)} max={num(l.perDay)} /> <span>{l.spentToday} / {l.perDay}</span>
                  </p>
                  <p className="text-xs">max {l.perTx} per transaction</p>
                </div>
              ))}
              <p className="text-sm">
                Receivers: {a.receivers ? a.receivers.join(', ') : 'any (Preflight decides)'} · approval {a.requireApproval ? 'required' : 'not required'}
              </p>
            </div>
            <div className="space-y-3">
              <p className="flex items-center gap-2">
                <Badge value={a.frozen ? 'block' : 'ok'} /> <span className="font-pixel text-sm">{a.frozen ? 'Frozen' : 'Can act'}</span>
              </p>
              {a.frozenReason && <p className="text-xs">{a.frozenReason}</p>}
              <p className="flex items-center gap-3 text-sm">
                strikes <PixelBar value={a.strikes} max={a.maxStrikes || 1} segments={Math.max(a.maxStrikes, 1)} /> {a.strikes}/{a.maxStrikes || '∞'}
              </p>
              {local && (
                a.frozen
                  ? <button className="px-btn" disabled={!!busy} onClick={() => owner('unfreeze', { agent_id: a.id })}>{busy === 'unfreeze' ? '…' : 'Unfreeze'}</button>
                  : <button className="px-btn" disabled={!!busy} onClick={() => owner('freeze', { agent_id: a.id, reason: 'frozen by owner from dashboard' })}>{busy === 'freeze' ? '…' : 'Freeze'}</button>
              )}
            </div>
          </div>
        </Panel>
      ))}

      {local && (
        <Panel title="Play the agent (local sandbox)">
          <p className="mb-3 text-sm">Each button is something the AI agent tries to do. Watch what gets through.</p>
          <div className="flex flex-wrap gap-3">
            {[['honest', 'Honest invoice'], ['injected', 'Prompt-injected invoice'], ['bypass', 'Bypass the guard'], ['new_vendor', 'New vendor']].map(([k, label]) => (
              <button key={k} className="px-btn" disabled={!!busy} onClick={() => run(k)}>{busy === k ? 'Running…' : label}</button>
            ))}
          </div>
          {log.length > 0 && (
            <ol className="mt-4 space-y-3">
              {log.map((r, i) => (
                <li key={i} className="border-l-4 border-ink pl-3">
                  <p className="flex flex-wrap items-center gap-2"><Badge value={r.status === 'executed' ? 'executed' : r.status === 'needs_human' ? 'needs_human' : 'refused'} /> <b className="text-sm">{r.label}</b></p>
                  <p className="text-sm">{r.status}: {r.message}</p>
                  <FailLensLink tx={r.txHash} signer={r.signer} />
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      <section className="hatch px-frame p-5">
        <div className="space-y-3 bg-paper p-4">
          <h2 className="font-pixel text-2xl">Panic</h2>
          <p className="text-sm">
            Freezes every agent, sends every balance back to the owner, and deletes the agent&apos;s access key.
            One transaction each, constant gas however many agents there are.
          </p>
          <div className="flex flex-wrap gap-3">
            {local ? (
              <button className={`px-btn ${armed ? 'bg-ink text-paper' : ''}`} disabled={!!busy || v.panicked} onClick={panic} onBlur={() => setArmed(false)}>
                {busy === 'panic' ? 'Stopping…' : armed ? 'Click again to confirm' : 'PANIC'}
              </button>
            ) : (
              <p className="text-sm">Connect the owner wallet to use Panic on {v.mode}.</p>
            )}
            {local && v.panicked && (
              <button className="px-btn" disabled={!!busy} onClick={() => owner('clear_panic')}>{busy === 'clear_panic' ? '…' : 'Clear panic'}</button>
            )}
          </div>
          {panicSteps && (
            <ul className="space-y-1 text-sm">
              {panicSteps.map((s, i) => (
                <li key={i}>
                  {s.error ? '✗' : '✓'} {s.step} {s.error && `— ${s.error}`} <FailLensLink tx={s.txHash} signer={s.signer} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
