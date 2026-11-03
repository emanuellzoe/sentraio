// Server-only helpers (route handlers / server components). Holds secrets from the
// environment; nothing here may be imported by a client component.
import { viewFunction } from '@sentineli/core';
import type { CheckResponse } from '@sentineli/preflight';
import { Account, JsonRpcProvider } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { chain, isLocalMode } from './config';

export const view = <T>(contract: string, method: string, args: unknown = {}) =>
  viewFunction<T>(contract, method, args, { rpcUrl: chain.rpcUrl });

export async function operator<T = CheckResponse[]>(path: string, body?: unknown): Promise<T> {
  const url = process.env.PREFLIGHT_URL;
  const token = process.env.PREFLIGHT_OPERATOR_TOKEN;
  if (!url || !token) throw new Error('Preflight service not configured (PREFLIGHT_URL / PREFLIGHT_OPERATOR_TOKEN).');
  const res = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `preflight ${res.status}`);
  return json as T;
}

/** Sign with a key from .env.local. Owner and agent full-access keys exist only on the local
 *  sandbox; the agent's function-call key (vault.execute only) may also be set on testnet. */
export function devAccount(who: 'owner' | 'agentFull' | 'agent'): Account {
  if (who !== 'agent' && !isLocalMode()) throw new Error('dev signing is only available on the local sandbox');
  const key = { owner: process.env.DEV_OWNER_KEY, agentFull: process.env.DEV_AGENT_FULL_KEY, agent: process.env.DEV_AGENT_KEY }[who];
  if (!key) throw new Error(`missing dev key for ${who}`);
  const id = who === 'owner' ? chain.ownerId : chain.agentId;
  return new Account(id, new JsonRpcProvider({ url: chain.rpcUrl }), key as KeyPairString);
}

export const txHash = (sent: unknown) => (sent as { transaction: { hash: string } }).transaction.hash;

/** The "play the agent" simulator needs the agent's function-call key and the Preflight service. */
export const agentSimulatorEnabled = () => Boolean(process.env.DEV_AGENT_KEY && process.env.PREFLIGHT_URL);
