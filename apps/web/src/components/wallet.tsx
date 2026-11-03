'use client';

// Browser wallet (Meteor, HOT, MyNearWallet, … via @hot-labs/near-connect) for owner
// actions on testnet/mainnet. On the local sandbox no wallet can connect, so the
// dashboard signs owner actions server-side with a dev key instead.
import type { NearConnector } from '@hot-labs/near-connect';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const NETWORK = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
export const walletEnabled = process.env.NEXT_PUBLIC_NETWORK !== 'local';

interface WalletCtx {
  accountId?: string;
  ready: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Sends one function call from the signed-in account; returns the transaction hash. */
  call(receiverId: string, methodName: string, args: object, depositYocto?: string, gasTgas?: number): Promise<string>;
}

const Ctx = createContext<WalletCtx>({
  ready: false,
  signIn: async () => {},
  signOut: async () => {},
  call: async () => {
    throw new Error('wallet not available');
  },
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connector = useRef<NearConnector | undefined>(undefined);
  const [accountId, setAccountId] = useState<string>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!walletEnabled) return;
    let alive = true;
    (async () => {
      const { NearConnector } = await import('@hot-labs/near-connect');
      const c = new NearConnector({ network: NETWORK, features: { signAndSendTransaction: true, testnet: NETWORK === 'testnet' || undefined }, footerBranding: null });
      connector.current = c;
      c.on('wallet:signIn', (t) => alive && setAccountId(t.accounts[0]?.accountId));
      c.on('wallet:signOut', () => alive && setAccountId(undefined));
      try {
        const { accounts } = await c.getConnectedWallet();
        if (alive) setAccountId(accounts[0]?.accountId);
      } catch {
        /* not connected yet */
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
      connector.current?.removeAllListeners();
    };
  }, []);

  const signIn = useCallback(async () => {
    const wallet = await connector.current!.connect();
    const accounts = await wallet.getAccounts();
    setAccountId(accounts[0]?.accountId);
  }, []);

  const signOut = useCallback(async () => {
    await connector.current!.disconnect();
    setAccountId(undefined);
  }, []);

  const call = useCallback<WalletCtx['call']>(async (receiverId, methodName, args, depositYocto = '0', gasTgas = 100) => {
    const wallet = await connector.current!.wallet();
    const outcome = await wallet.signAndSendTransaction({
      receiverId,
      actions: [{ type: 'FunctionCall', params: { methodName, args, gas: (BigInt(gasTgas) * 10n ** 12n).toString(), deposit: depositYocto } }],
    });
    return (outcome as unknown as { transaction: { hash: string } }).transaction.hash;
  }, []);

  return <Ctx.Provider value={{ accountId, ready, signIn, signOut, call }}>{children}</Ctx.Provider>;
}

export const useWallet = () => useContext(Ctx);

export function WalletButton() {
  const { accountId, ready, signIn, signOut } = useWallet();
  if (!walletEnabled) return <span className="badge dither-50 badge-dither text-[10px]"><span>LOCAL SANDBOX</span></span>;
  if (!ready) return <span className="font-pixel text-xs">…</span>;
  return accountId ? (
    <button type="button" className="px-btn py-1 text-xs" onClick={signOut} title="Disconnect">
      {accountId.length > 22 ? `${accountId.slice(0, 20)}…` : accountId} ✕
    </button>
  ) : (
    <button type="button" className="px-btn px-btn-solid py-1 text-xs" onClick={signIn}>Connect wallet</button>
  );
}
