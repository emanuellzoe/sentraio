import Link from 'next/link';
import { PixelShield } from '@/components/pixel-shield';
import { Badge } from '@/components/verdict';

// Results from `pnpm demo:attack` (demo/attack/last-run.log): same agent, same invoices.
const ACTS = [
  { n: 1, tries: 'Pays a prompt-injected invoice from a plain wallet key', result: 'failed', outcome: 'Attacker +5 NEAR. The wallet signs whatever the agent decides.' },
  { n: 2, tries: 'Pays an honest invoice through Sentineli', result: 'allow', outcome: 'Shop +2 NEAR, every check green, outcome explained by FailLens.' },
  { n: 3, tries: 'Pays the same injected invoice through Sentineli', result: 'block', outcome: 'shop-payrnents looks like shop-payments: address poisoning. Attacker +0.' },
  { n: 4, tries: 'Compromised code skips the guard and calls the vault', result: 'block', outcome: 'Vault: approval missing / bad signature. Runtime: key cannot transfer NEAR.' },
  { n: 5, tries: 'Pays a vendor it has never paid before', result: 'warn', outcome: 'Waits for a human. Operator confirms, then it pays.' },
];

const LAYERS = [
  {
    name: 'Preflight',
    line: 'Checks the counterparty before anything is signed.',
    points: [
      'Receiver exists, is a contract, changed code recently, age and activity',
      'Look-alike names and implicit-address poisoning',
      'Shared evidence-backed blocklist (registry contract)',
      'Sandbox simulation on real token code with real balances',
      'allow signs · warn asks a human · block refuses',
    ],
    href: '/preflight',
  },
  {
    name: 'Vault',
    line: 'On-chain mandate the agent cannot step outside of.',
    points: [
      'Per-asset limits per transaction and per day, receiver allowlist, expiry',
      'Moves funds only with a fresh Preflight signature (nonce, ≤10 min)',
      'Strikes auto-freeze the agent; only the owner unfreezes',
      'Panic: freeze all, drain to owner, constant gas',
      'Covers native NEAR transfers too',
    ],
    href: '/vault',
  },
  {
    name: 'FailLens',
    line: 'Explains what actually happened, in plain words.',
    points: [
      'Reads every receipt, not just the top-level status',
      'Failures with a concrete fix (e.g. storage_deposit first)',
      'Where the funds are now, ignoring reverted logs',
      'Works on any NEAR transaction, testnet or mainnet',
    ],
    href: '/faillens',
  },
];

const LIMITS = [
  'Simulation fully reproduces standard NEP-141 tokens. Contracts with too much state (big DEXes) run partially, and Preflight says so with a warn instead of pretending.',
  'Approvals expire within 10 minutes and are single-use, which narrows but does not remove the gap between simulation and execution.',
  'Registry “blocked” requires a moderator. Many community reports only make an account “suspected”, so sybil wallets cannot hard-block a legitimate one.',
  'A function-call key’s allowance pays gas only and cannot be topped up; the owner keeps the agent account’s full-access key to rotate it.',
];

function Box({ title, sub, solid = false }: { title: string; sub: string; solid?: boolean }) {
  return (
    <div className={`px-frame-sm px-3 py-2 text-center ${solid ? 'bg-ink text-paper' : 'bg-paper'}`}>
      <p className="font-pixel text-sm">{title}</p>
      <p className="text-xs">{sub}</p>
    </div>
  );
}

const Arrow = ({ label }: { label?: string }) => (
  <div className="flex flex-col items-center justify-center px-1 text-center">
    {label && <span className="font-pixel text-[10px] leading-tight">{label}</span>}
    <span className="font-pixel text-lg leading-none">→</span>
  </div>
);

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-8 md:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
        <p className="badge badge-solid text-xs">NEAR Hackathon 2026 · Security · Open · DeFi</p>
        <h1 className="font-pixel text-4xl leading-tight lg:text-5xl">
          A guard for AI agents
          <br />
          that hold money.
        </h1>
        <p className="max-w-2xl text-lg">
          Sentineli checks who your agent is about to pay, simulates the payment against real chain state,
          and only lets an on-chain vault move funds with its signed approval. When something fails, FailLens
          tells you why and where the money is.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/vault" className="px-btn">Open the dashboard</Link>
          <Link href="/faillens" className="px-btn">Explain a transaction</Link>
          <Link href="/preflight" className="px-btn">Try Preflight</Link>
        </div>
        </div>
        <div className="px-frame bg-paper p-4">
          <PixelShield />
          <p className="mt-2 border-t-2 border-ink pt-2 font-pixel text-xs">Attacks in · nothing through</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-pixel text-2xl">How a payment flows</h2>
        <div className="px-frame overflow-x-auto bg-paper p-5">
          <div className="grid min-w-[760px] grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1">
            <Box title="AI agent" sub="LLM decides to pay" />
            <Arrow label="plan" />
            <Box title="Guard" sub="agent-side wrapper" />
            <Arrow label="check" />
            <Box title="Preflight" sub="signals + sandbox" solid />
            <Arrow label="signed ok" />
            <Box title="Vault" sub="on-chain mandate" solid />
            <Arrow label="pays" />
            <Box title="Receiver" sub="shop.near" />
          </div>
          <div className="mt-4 grid min-w-[760px] grid-cols-3 gap-4 text-sm">
            <div className="hatch border-2 border-ink p-2"><p className="bg-paper p-2"><b>✗ block</b> — Preflight never signs; the guard refuses.</p></div>
            <div className="dither-25 border-2 border-ink p-2"><p className="bg-paper p-2"><b>! warn</b> — an operator decides; the agent token cannot approve itself.</p></div>
            <div className="hatch border-2 border-ink p-2"><p className="bg-paper p-2"><b>✗ bypass</b> — the vault rejects calls without a valid, unused signature.</p></div>
          </div>
        </div>
        <p className="text-sm">
          The agent holds only a function-call key for <code>vault.execute</code>. It has no key that can approve a
          payment, move NEAR directly, or add keys. Code enforces; AI explains.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-pixel text-2xl">The attack, replayed</h2>
        <p className="max-w-3xl text-sm">
          One prompt-injected invoice, five situations. Run it yourself with <code className="bg-ink px-1 text-paper">pnpm demo:attack</code>{' '}
          (local sandbox, no keys, no funds).
        </p>
        <div className="px-frame bg-paper">
          <table className="w-full text-sm">
            <tbody>
              {ACTS.map((a) => (
                <tr key={a.n} className="border-b-2 border-ink align-top last:border-0">
                  <td className="w-16 p-3 font-pixel text-xl">{a.n}</td>
                  <td className="p-3">{a.tries}</td>
                  <td className="w-28 p-3"><Badge value={a.result} /></td>
                  <td className="p-3">{a.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-pixel text-2xl">Three layers</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {LAYERS.map((l) => (
            <Link key={l.name} href={l.href} className="px-frame group block bg-paper hover:bg-ink hover:text-paper">
              <div className="border-b-2 border-ink px-4 py-2 font-pixel text-lg group-hover:border-paper">{l.name}</div>
              <div className="space-y-3 p-4">
                <p className="font-semibold">{l.line}</p>
                <ul className="space-y-1 text-sm">
                  {l.points.map((p) => <li key={p}>▪ {p}</li>)}
                </ul>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid items-start gap-6 md:grid-cols-2">
        <div className="px-frame bg-paper p-5">
          <h2 className="mb-3 font-pixel text-xl">Next to NEAR&apos;s Agent API</h2>
          <p className="text-sm">
            The Agent API already caps spending and can freeze an agent, but its policy does not protect native
            methods, and it does not ask <i>who</i> is being paid. Sentineli adds the counterparty check, the
            simulation, a vault that covers native transfers, and the failure explainer. Use both.
          </p>
        </div>
        <div className="dither-25 px-frame p-5">
          <div className="bg-paper p-4">
            <h2 className="mb-3 font-pixel text-xl">Honest limits</h2>
            <ul className="space-y-2 text-sm">
              {LIMITS.map((l) => <li key={l}>▪ {l}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-frame bg-ink p-5 text-paper">
        <h2 className="mb-3 font-pixel text-xl">Run it</h2>
        <pre className="overflow-x-auto text-sm leading-relaxed">{`pnpm install
pnpm demo:attack                  # the five acts above, in a local sandbox
pnpm dev:chain                    # long-running sandbox for the dashboard
pnpm --filter @sentineli/web dev  # http://localhost:3000`}</pre>
      </section>
    </div>
  );
}
