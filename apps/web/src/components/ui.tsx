'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/** Segmented pixel bar: filled blocks for `value / max`. */
export function PixelBar({ value, max, segments = 12 }: { value: number; max: number; segments?: number }) {
  const filled = max > 0 ? Math.min(segments, Math.round((value / max) * segments)) : 0;
  return (
    <span className="inline-flex gap-[2px] align-middle" aria-label={`${value} of ${max}`}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={`inline-block h-3 w-2 border border-ink ${i < filled ? 'bg-ink' : 'bg-paper'}`} />
      ))}
    </span>
  );
}

export function XRayLink({ tx, network = 'local' }: { tx?: string; signer?: string; network?: string }) {
  if (!tx) return null;
  return (
    <span className="inline-flex gap-3">
      <Link className="underline decoration-2 underline-offset-2" href={`/xray?${new URLSearchParams({ tx, network })}`}>
        Tx X-Ray ↗
      </Link>
      {network !== 'local' && (
        <a className="underline decoration-2 underline-offset-2" href={`https://${network === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${tx}`} target="_blank" rel="noreferrer">
          explorer ↗
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

export function NotConfigured() {
  return (
    <div className="dither-25 px-frame p-6">
      <div className="inline-block space-y-2 bg-paper p-3">
        <p className="font-pixel">No vault configured.</p>
        <p className="text-sm">
          Run <code className="bg-ink px-1 text-paper">pnpm dev:chain</code> for a local sandbox (writes <code>apps/web/.env.local</code>), then restart the web app.
        </p>
      </div>
    </div>
  );
}
