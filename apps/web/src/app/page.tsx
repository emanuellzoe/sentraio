import Link from 'next/link';
import { RotatingLine } from '@/components/landing';
import { ShieldHero } from '@/components/shield-hero';
import { Badge } from '@/components/verdict';

// ---------------------------------------------------------------- content
// Numbers come from the test suite and sandbox runs (see contracts/, packages/, demo/attack/).

const CHIPS = ['Rules on-chain', 'Reasons in plain words', 'Allow signs', 'Warn asks a human', 'Block refuses', 'Panic in one click'];

const GLANCE = [
  { action: 'Agent payment', gas: '6.9 Tgas', cost: '~0.0007 NEAR' },
  { action: 'Payment with Clearance signature', gas: '7.2 Tgas', cost: '~0.0007 NEAR' },
  { action: 'Rejected attempt (strike)', gas: '2.1 Tgas', cost: '~0.0002 NEAR' },
  { action: 'Panic, 10 tokens + NEAR drained', gas: '47.7 Tgas', cost: '~0.0048 NEAR' },
  { action: 'Blocklist report', gas: '1.9 Tgas', cost: '~0.0002 NEAR' },
];
const STATS = [
  { n: '9', label: 'independent checks per payment' },
  { n: '62', label: 'unit tests across contracts and packages' },
  { n: '0', label: 'NEAR lost to the injected invoice' },
  { n: '16%', label: 'of the 300 Tgas limit in the worst case' },
];

const LAYERS = [
  {
    icon: 'magnifier', tint: 'from-blue to-indigo', name: 'Clearance', tagline: 'Who is being paid, and what will really happen?',
    body: 'Checks the receiver and the token before anything is signed, then simulates the payment on real contract code with real balances in a sandbox.',
    chips: ['Look-alike names', 'Registry', 'Code changes', 'Simulation'], href: '/clearance', cta: 'Try Clearance',
  },
  {
    icon: 'lock', tint: 'from-green to-blue', name: 'Vault', tagline: 'The mandate the agent cannot step outside of.',
    body: 'On-chain limits per transaction and per day, single-use Clearance signatures, strikes that auto-freeze, and a constant-gas panic switch. Native NEAR included.',
    chips: ['Limits', 'Approvals', 'Auto-freeze', 'Panic'], href: '/vault', cta: 'Open the vault',
  },
  {
    icon: 'xray', tint: 'from-orange to-red', name: 'Tx X-Ray', tagline: 'Success on top, failure inside? It tells you.',
    body: 'Reads every receipt of any NEAR transaction, explains each failure with a fix, and shows where the funds actually are now.',
    chips: ['Receipt tree', 'Fix hints', 'Funds now', 'Testnet + mainnet'], href: '/xray', cta: 'Explain a transaction',
  },
] as const;

const STEPS = [
  { title: 'Agent plans', body: 'The LLM decides to pay. It holds only a function-call key for vault.execute.' },
  { title: 'Clearance checks', body: 'Nine signals, worst wins. Allow signs, warn waits for the owner, block refuses.' },
  { title: 'Vault enforces', body: 'Limits, receiver rules and a valid, unused signature, or nothing moves.' },
  { title: 'Tx X-Ray explains', body: 'Every outcome comes back as a plain-language report with the funds trail.' },
];

const ACTS = [
  { tries: 'Injected invoice, plain wallet key', verdict: 'failed', outcome: 'Attacker +5 NEAR.' },
  { tries: 'Honest invoice, through Sentraio', verdict: 'allow', outcome: 'Shop +2 NEAR, explained.' },
  { tries: 'Same injected invoice, through Sentraio', verdict: 'block', outcome: 'shop-payrnents ≈ shop-payments. Attacker +0.' },
  { tries: 'Compromised code calls the vault', verdict: 'block', outcome: 'Approval missing or forged. The key cannot move NEAR.' },
  { tries: 'First order from a new vendor', verdict: 'warn', outcome: 'The owner signs off in the wallet, then it pays.' },
];

const STACK: { name: string; what: string; links: [string, string][] }[] = [
  { name: 'near-sdk (Rust)', what: 'Vault and registry contracts, pinned to build for mainnet protocol 86.', links: [['Docs', 'https://docs.near.org/smart-contracts/what-is']] },
  { name: 'near-workspaces sandbox', what: 'Clearance simulation and every end-to-end test.', links: [['Git', 'https://github.com/near/near-workspaces-js']] },
  { name: 'NEP-141 / NEP-297', what: 'Token transfers and event logs that the vault and Tx X-Ray speak.', links: [['Spec', 'https://nomicon.io/Standards/Tokens/FungibleToken/Core']] },
  { name: 'NEP-413', what: 'Owner approvals are signed messages from a full-access key.', links: [['Spec', 'https://github.com/near/NEPs/blob/master/neps/nep-0413.md']] },
  { name: 'Function-call keys', what: 'The agent key: one contract, one method, gas-only allowance.', links: [['Docs', 'https://docs.near.org/protocol/access-keys']] },
  { name: 'NearBlocks API', what: 'Receiver age and activity signals.', links: [['API', 'https://api.nearblocks.io/api-docs']] },
  { name: 'FastNEAR RPC', what: 'Regular and archival nodes, so Tx X-Ray also reads old transactions.', links: [['Site', 'https://fastnear.com']] },
  { name: 'Agent API', what: 'Spending policy for agents. Sentraio covers what it does not: counterparties, simulation, native methods.', links: [['Docs', 'https://docs.agentsonintents.com']] },
];

const LIMITS = [
  'Simulation fully reproduces standard NEP-141 tokens; contracts with too much state (big DEXes) run partially, and Clearance says so with a warn.',
  'Approvals are single-use and expire within 10 minutes: this narrows, but does not remove, the gap between simulation and execution.',
  'Registry “blocked” needs a moderator. Many community reports only make an account “suspected”, so sybils cannot hard-block anyone.',
  'A function-call key’s allowance pays gas only and cannot be topped up; the owner keeps the full-access key to rotate it.',
];

const FAQ: [string, string][] = [
  ['Isn’t this what NEAR’s Agent API already does?', 'The Agent API caps spending and can freeze an agent, but its policy does not protect native methods and it does not ask who is being paid. Sentraio adds the counterparty check, simulation, a vault that covers native transfers, and the failure explainer. Use both.'],
  ['What if a prompt injection takes over the agent?', 'The agent can still only ask. Clearance blocks look-alike or reported receivers, and the vault refuses any call without a valid, unused Clearance signature. The agent’s key cannot transfer NEAR or add keys.'],
  ['Can the agent approve its own warning?', 'No. Answering a warn needs a fresh NEP-413 signature from a full-access key of the vault owner, checked on chain, single-use and valid for five minutes. The agent has no such key.'],
  ['What if the guardian (Clearance) key leaks?', 'An attacker could sign approvals, but only inside the owner’s mandate: limits and receiver rules are enforced by the contract. The owner rotates the guardian or hits Panic.'],
  ['What happens when a transfer fails?', 'The vault puts the amount back into its ledger and the daily budget. Tx X-Ray shows the failed receipt, the refund and where the funds are. Untracked tokens can be recovered with sync_balance.'],
  ['Can attackers knock the contracts over with bots?', 'Every caller pays their own gas and cannot grow the vault’s state. Loops are bounded (10 tokens, 50 receivers), and Panic costs the same however many agents exist.'],
];

// ---------------------------------------------------------------- pieces

function SectionHead({ eyebrow, title, sub, id }: { eyebrow: string; title: string; sub?: string; id: string }) {
  return (
    <header id={id} className="scroll-mt-24 space-y-2">
      <p className="text-sm font-semibold text-blue">{eyebrow}</p>
      <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      {sub && <p className="max-w-2xl text-lg text-label2">{sub}</p>}
    </header>
  );
}

function Glyph({ name }: { name: (typeof LAYERS)[number]['icon'] }) {
  const common = { fill: 'none', stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      {name === 'magnifier' && (<><circle cx="10.5" cy="10.5" r="6" {...common} /><path d="M15 15l5 5" {...common} /></>)}
      {name === 'lock' && (<><rect x="5" y="11" width="14" height="10" rx="2.5" {...common} /><path d="M8 11V8a4 4 0 018 0v3" {...common} /></>)}
      {name === 'xray' && (<><path d="M4 12h3l2-5 4 10 2-5h5" {...common} /></>)}
    </svg>
  );
}

// ---------------------------------------------------------------- page

export default function Home() {
  return (
    <div className="space-y-24 pb-24">
      {/* hero */}
      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1.25fr_1fr]">
        <div className="fade-in space-y-6">
          <span className="pill pill-blue">Agent security on NEAR</span>
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            AI agents can hold money now.
            <span className="block text-label2">Sentraio decides what they may do with it.</span>
          </h1>
          <RotatingLine items={['checks who gets paid', 'simulates the payment', 'gates the vault on-chain', 'asks the owner when unsure', 'explains every failure']} />
          <p className="max-w-xl text-lg text-label2">
            A prompt-injected agent will try to pay the wrong account. <span className="font-semibold text-label">With Sentraio, the money stays where it is.</span>
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/vault" className="ios-btn px-5 py-3 text-base">Try the attack</Link>
            <a href="#layers" className="ios-btn ios-btn-tinted px-5 py-3 text-base">How it works</a>
          </div>
        </div>
        <div className="ios-card fade-in p-6">
          <ShieldHero className="h-auto w-full" />
          <p className="pt-2 text-center text-sm text-label2">Payments in, nothing unapproved through.</p>
        </div>
      </section>

      <div className="-mt-12 flex flex-wrap justify-center gap-2">
        {CHIPS.map((c) => <span key={c} className="pill pill-gray text-sm">{c}</span>)}
      </div>

      {/* at a glance */}
      <section className="space-y-8">
        <SectionHead id="glance" eyebrow="At a glance" title="Cheap to run, hard to fool." sub="Measured in the sandbox, not estimated: every number comes from the test suite or a worst-case run." />
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="section-header">Gas per action · 0.0001 NEAR per Tgas</p>
            <div className="ios-group">
              {GLANCE.map((g) => (
                <div key={g.action} className="ios-row justify-between">
                  <span>{g.action}</span>
                  <span className="text-right text-sm text-label2">{g.gas}<br />{g.cost}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 self-end">
            {STATS.map((s) => (
              <div key={s.label} className="ios-card p-5">
                <p className="font-display text-4xl font-bold tracking-tight">{s.n}</p>
                <p className="mt-1 text-sm text-label2">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* layers */}
      <section className="space-y-8">
        <SectionHead id="layers" eyebrow="Three layers" title="Check. Enforce. Explain." sub="Each layer works on its own; together the agent can only ask, never take." />
        <div className="grid gap-5 md:grid-cols-3">
          {LAYERS.map((l) => (
            <article key={l.name} className="ios-card flex flex-col gap-4 p-6">
              <span className={`flex h-12 w-12 items-center justify-center rounded-[14px] bg-linear-to-b ${l.tint} shadow-sm`}><Glyph name={l.icon} /></span>
              <div className="space-y-1">
                <h3 className="font-display text-2xl font-bold">{l.name}</h3>
                <p className="font-medium text-label2">{l.tagline}</p>
              </div>
              <p className="flex-1 text-sm text-label2">{l.body}</p>
              <div className="flex flex-wrap gap-1.5">
                {l.chips.map((c) => <span key={c} className="pill pill-gray">{c}</span>)}
              </div>
              <Link href={l.href} className="ios-link font-semibold">{l.cta} ›</Link>
            </article>
          ))}
        </div>
      </section>

      {/* flow */}
      <section className="space-y-8">
        <SectionHead id="flow" eyebrow="How a payment flows" title="Four steps, one signature." />
        <ol className="grid gap-5 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="ios-card space-y-2 p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue text-sm font-bold text-white">{i + 1}</span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-label2">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['block', 'Block', 'Clearance never signs; the guard refuses.'],
            ['warn', 'Warn', 'The owner decides with a wallet signature; the agent cannot approve itself.'],
            ['block', 'Bypass', 'The vault rejects calls without a valid, unused signature.'],
          ].map(([v, t, d]) => (
            <div key={t} className="ios-card flex items-start gap-3 p-5">
              <Badge value={v} />
              <p className="text-sm"><span className="font-semibold">{t}.</span> <span className="text-label2">{d}</span></p>
            </div>
          ))}
        </div>
      </section>

      {/* attack */}
      <section className="space-y-8">
        <SectionHead id="attack" eyebrow="The attack, replayed" title="One injected invoice, five situations." sub="Run it yourself with pnpm demo:attack: local sandbox, no keys, no funds." />
        <div className="ios-group">
          {ACTS.map((a, i) => (
            <div key={a.tries} className="ios-row flex-wrap">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-fill text-sm font-semibold text-label2">{i + 1}</span>
              <span className="min-w-[14rem] flex-1 font-medium">{a.tries}</span>
              <span className="flex-1 text-sm text-label2">{a.outcome}</span>
              <Badge value={a.verdict} />
            </div>
          ))}
        </div>
      </section>

      {/* stack */}
      <section className="space-y-8">
        <SectionHead id="stack" eyebrow="Built on NEAR" title="What it stands on." />
        <div className="ios-group md:columns-2 md:gap-0 [&>*]:break-inside-avoid">
          {STACK.map((s) => (
            <div key={s.name} className="ios-row items-start">
              <div className="flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-sm text-label2">{s.what}</p>
              </div>
              {s.links.map(([label, href]) => (
                <a key={href} href={href} target="_blank" rel="noreferrer" className="ios-link text-sm">{label} ↗</a>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* run it */}
      <section className="space-y-8">
        <SectionHead id="run" eyebrow="Run it" title="Three commands, no wallet needed." sub="Real contracts and real token code in a local NEAR sandbox, with fake money." />
        <div className="ios-card overflow-hidden">
          <div className="flex items-center gap-1.5 border-b-[0.5px] border-sep px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red" /><span className="h-3 w-3 rounded-full bg-orange" /><span className="h-3 w-3 rounded-full bg-green" />
            <span className="ml-3 text-xs text-label2">Terminal</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed">{`pnpm install
pnpm demo:attack                  # the five situations above
pnpm dev:chain                    # sandbox for the dashboard
pnpm --filter @sentraio/web dev  # http://localhost:3000`}</pre>
        </div>
      </section>

      {/* limits */}
      <section className="space-y-8">
        <SectionHead id="limits" eyebrow="Honest limits" title="What it does not promise." />
        <div className="ios-group">
          {LIMITS.map((l) => (
            <div key={l} className="ios-row items-start text-sm">
              <span className="pill pill-orange flex-none">!</span>
              <span className="text-label2">{l}</span>
            </div>
          ))}
        </div>
      </section>

      {/* faq */}
      <section className="space-y-8">
        <SectionHead id="faq" eyebrow="Questions" title="Questions judges should ask." />
        <div className="ios-group">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="ios-row cursor-pointer list-none justify-between font-medium">
                {q}
                <span className="text-label3 transition-transform group-open:rotate-90">›</span>
              </summary>
              <p className="px-4 pb-4 text-sm text-label2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* floating demo bar */}
      <div className="pointer-events-none sticky bottom-5 z-20 flex justify-center">
        <div className="ios-nav pointer-events-auto flex items-center gap-4 rounded-full border-[0.5px] border-sep py-2 pr-2 pl-5 shadow-lg">
          <p className="text-sm font-medium">Play the agent and watch what gets through</p>
          <Link href="/vault" className="ios-btn py-1.5 text-sm">Try it</Link>
        </div>
      </div>
    </div>
  );
}
