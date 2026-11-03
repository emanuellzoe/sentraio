'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/** iOS-style progress bar; turns orange then red as it fills up. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const colour = pct >= 100 ? 'bg-red' : pct >= 75 ? 'bg-orange' : 'bg-blue';
  return (
    <span className="inline-block h-1.5 w-40 overflow-hidden rounded-full bg-fill align-middle" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span className={`block h-full rounded-full transition-[width] duration-500 ${colour}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function XRayLink({ tx, network = 'local' }: { tx?: string; signer?: string; network?: string }) {
  if (!tx) return null;
  return (
    <span className="inline-flex gap-3 text-sm">
      <Link className="ios-link" href={`/xray?${new URLSearchParams({ tx, network })}`}>
        Tx X-Ray ›
      </Link>
      {network !== 'local' && (
        <a className="ios-link" href={`https://${network === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${tx}`} target="_blank" rel="noreferrer">
          Explorer ↗
        </a>
      )}
    </span>
  );
}

/** Polls a JSON endpoint; `reload()` refreshes immediately. */
export function usePoll<T>(url: string, ms = 3000) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setData(body);
        setError(undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms]);
  return { data, error, reload };
}

export async function postJson<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function Skeleton({ h = 'h-40' }: { h?: string }) {
  return <div className={`ios-card ${h} animate-pulse`} />;
}

export function Notice({ title, children, tone = 'gray' }: { title: string; children?: React.ReactNode; tone?: 'gray' | 'red' | 'orange' }) {
  const icon = tone === 'red' ? '✕' : tone === 'orange' ? '!' : 'i';
  const colour = tone === 'red' ? 'text-red' : tone === 'orange' ? 'text-orange' : 'text-blue';
  return (
    <div className="ios-card flex gap-3 p-5">
      <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full bg-fill text-sm font-bold ${colour}`}>{icon}</span>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-sm text-label2">{children}</div>}
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <Notice title="No vault configured">
      Run <code className="rounded bg-fill px-1.5 py-0.5 font-mono text-xs">pnpm dev:chain</code> for a local sandbox (writes <code className="font-mono text-xs">apps/web/.env.local</code>), then restart the web app.
    </Notice>
  );
}
