import { formatAmount, viewAccount } from '@sentineli/core';
import { chain, isConfigured } from '@/lib/config';
import { agentSimulatorEnabled, view } from '@/lib/server';

interface Mandate {
  limits: { asset: string; per_tx: string; per_day: string }[];
  allowed_receivers: string[] | null;
  expires_at_ns: string | null;
  require_approval: boolean;
  max_strikes: number;
  strikes: number;
  frozen: boolean;
  frozen_reason: string | null;
  nonce: number;
  spends: { asset: string; window_start_ns: string; spent: string }[];
}

const fmt = (asset: string, v: string) => (asset === 'NEAR' ? `${formatAmount(v, 24)} NEAR` : `${v} ${asset}`);

export async function GET() {
  if (!isConfigured()) return Response.json({ configured: false });
  try {
    const [acc, owner, guardian, panicked, balances, agents] = await Promise.all([
      viewAccount(chain.vaultId, { rpcUrl: chain.rpcUrl }),
      view<string>(chain.vaultId, 'get_owner'),
      view<{ account_id: string; public_key: string } | null>(chain.vaultId, 'get_guardian'),
      view<boolean>(chain.vaultId, 'is_panicked'),
      view<[string, string][]>(chain.vaultId, 'get_balances'),
      view<[string, Mandate][]>(chain.vaultId, 'list_agents', { from_index: 0, limit: 50 }),
    ]);
    const now = BigInt(Date.now()) * 1_000_000n;
    const DAY = 86_400n * 1_000_000_000n;
    return Response.json({
      configured: true,
      mode: chain.mode,
      vaultId: chain.vaultId,
      agentHint: chain.agentId,
      agentSimulator: agentSimulatorEnabled(),
      owner,
      guardian,
      panicked,
      codeHash: acc?.code_hash,
      codeHashPinned: chain.vaultCodeHash || null,
      balances: balances.map(([asset, v]) => ({ asset, display: fmt(asset, v) })),
      agents: agents.map(([id, m]) => ({
        id,
        frozen: m.frozen,
        frozenReason: m.frozen_reason,
        strikes: m.strikes,
        maxStrikes: m.max_strikes,
        requireApproval: m.require_approval,
        receivers: m.allowed_receivers,
        nonce: m.nonce,
        limits: m.limits.map((l) => {
          const s = m.spends.find((x) => x.asset === l.asset && now < BigInt(x.window_start_ns) + DAY);
          return { asset: l.asset, perTx: fmt(l.asset, l.per_tx), perDay: fmt(l.asset, l.per_day), spentToday: fmt(l.asset, s?.spent ?? '0') };
        }),
      })),
    });
  } catch (e) {
    return Response.json({ configured: true, error: (e as Error).message }, { status: 502 });
  }
}
