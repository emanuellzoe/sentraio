import { lookalike, priorInteraction, receiverAccount, receiverReputation, registry, tokenContract, vaultIntegrity, vaultPolicy } from './signals.ts';
import type { Ctx } from './signals.ts';
import { MemoryStore } from './store.ts';
import type { Decision, Level, ClearanceConfig, ClearanceRequest, Signal } from './types.ts';

const RANK: Record<Level, number> = { ok: 0, warn: 1, block: 2 };
export const worst = (levels: Level[]): Level => levels.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

/**
 * Deterministic decision: every check returns ok / warn / block and the verdict is the
 * worst of them. A check that errors becomes a warn, never a silent pass.
 */
export async function runClearance(req: ClearanceRequest, cfg: ClearanceConfig = {}): Promise<Decision> {
  const ctx: Ctx = {
    cfg,
    view: { network: cfg.network ?? 'testnet', rpcUrl: cfg.rpcUrl, fetchImpl: cfg.fetchImpl },
    store: cfg.store ?? new MemoryStore(),
    now: cfg.now?.() ?? new Date(),
  };
  const guard = async <T extends Signal | Signal[]>(id: string, run: () => Promise<T>): Promise<Signal[]> => {
    try {
      const r = await run();
      return Array.isArray(r) ? r : [r];
    } catch (e) {
      return [{ id, level: 'warn', title: `Check "${id}" could not run`, detail: (e as Error).message, source: 'clearance' }];
    }
  };

  // policy first: its mandate feeds the allowlist-based checks
  let mandate: Awaited<ReturnType<typeof vaultPolicy>>['mandate'];
  const policy = await guard('vault_policy', async () => {
    const r = await vaultPolicy(ctx, req);
    mandate = r.mandate;
    return r.signal;
  });

  const signals = [
    ...policy,
    ...(await Promise.all([
      guard('vault_code', () => vaultIntegrity(ctx, req.vaultId)),
      guard('receiver_exists', () => receiverAccount(ctx, req)),
      guard('token_contract', () => tokenContract(ctx, req)),
      guard('receiver_age', () => receiverReputation(ctx, req.action.receiver_id)),
      guard('prior_interaction', () => priorInteraction(ctx, req, mandate)),
      guard('registry', () => registry(ctx, req)),
      guard('lookalike', () => lookalike(ctx, req, mandate)),
    ])).flat(),
  ];

  // simulating an action the vault or a hard signal already blocks is wasted time
  let simulation: Decision['simulation'];
  if (cfg.simulate && worst(signals.map((s) => s.level)) !== 'block') {
    simulation = await cfg.simulate(req).catch((e: Error) => ({
      coverage: 'skipped' as const,
      signals: [{ id: 'simulation', level: 'warn' as const, title: 'Simulation could not run', detail: e.message, source: 'sandbox' }],
      durationMs: 0,
    }));
    signals.push(...simulation.signals);
  }

  const level = worst(signals.map((s) => s.level));
  return { verdict: level === 'ok' ? 'allow' : level, request: req, signals, simulation, summary: summarize(level, signals), checkedAt: ctx.now.toISOString() };
}

function summarize(verdict: Level, signals: Signal[]): string {
  const flagged = signals.filter((s) => s.level === verdict && verdict !== 'ok').map((s) => s.title);
  if (verdict === 'ok') return 'All checks passed.';
  const head = verdict === 'block' ? 'Blocked' : 'Needs a human';
  return `${head}: ${flagged.join('; ')}.`;
}
