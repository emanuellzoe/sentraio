import Link from 'next/link';
import { HandsField } from '@/components/hands-field';
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
    name: 'Clearance', tagline: 'Who is being paid, and what will really happen?',
    body: 'Checks the receiver and the token before anything is signed, then simulates the payment on real contract code with real balances in a sandbox.',
    chips: ['Look-alike names', 'Registry', 'Code changes', 'Simulation'], href: '/clearance', cta: 'Try Clearance',
  },
  {
    name: 'Vault', tagline: 'The mandate the agent cannot step outside of.',
    body: 'On-chain limits per transaction and per day, single-use Clearance signatures, strikes that auto-freeze, and a constant-gas panic switch. Native NEAR included.',
    chips: ['Limits', 'Approvals', 'Auto-freeze', 'Panic'], href: '/vault', cta: 'Open the vault',
  },
  {
    name: 'Tx X-Ray', tagline: 'Success on top, failure inside? It tells you.',
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

const OUTCOMES: [string, string, string][] = [
  ['block', 'Block', 'Clearance never signs; the guard refuses.'],
  ['warn', 'Warn', 'The owner decides with a wallet signature; the agent cannot approve itself.'],
  ['block', 'Bypass', 'The vault rejects calls without a valid, unused signature.'],
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

const pad = (i: number) => String(i + 1).padStart(2, '0');

/** Editorial section: a 1px rule, a monospace index on the left, the title and content on the right. */
function Section({ n, label, title, sub, id, children }: { n: string; label: string; title: string; sub?: string; id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-sep pt-6">
      <div className="grid gap-6 md:grid-cols-12 md:gap-10">
        <p className="mono-label md:col-span-3">{n} — {label}</p>
        <div className="space-y-10 md:col-span-9">
          <header className="space-y-3">
            <h2 className="max-w-3xl text-3xl font-medium leading-[1.08] tracking-[-0.03em] md:text-[2.5rem]">{title}</h2>
            {sub && <p className="max-w-2xl text-lg text-label2">{sub}</p>}
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}

const Rows = ({ children }: { children: React.ReactNode }) => <ul className="divide-y divide-sep border-y border-sep">{children}</ul>;

// ---------------------------------------------------------------- page

export default function Home() {
  return (
    <div className="space-y-24 pb-28">
      {/* hero: full viewport, copy centred, two hands drawn live behind it */}
      <section className="relative left-1/2 -mx-[50vw] -mt-10 w-screen min-h-[calc(100svh-65px)] overflow-hidden">
        <HandsField className="pointer-events-none absolute inset-0 z-0 block" />
        <div className="fade-in relative z-10 mx-auto flex max-w-3xl flex-col items-center px-5 pt-[11vh] text-center">
          <p className="mono-label">Agent security on NEAR</p>
          <h1 className="mt-6 text-[clamp(2.4rem,4.6vw,4.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            <span className="block text-label2">AI agents can hold money now.</span>
            Sentraio decides what they may do with it.
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-label2">
            A prompt-injected agent will try to pay the wrong account. With Sentraio, the money stays where it is.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/vault" className="ios-btn px-6">Try the attack</Link>
            <a href="#layers" className="ios-btn ios-btn-tinted px-6">How it works</a>
          </div>
        </div>
      </section>

      <p className="mono-label -mt-12 border-y border-sep py-4 text-center">{CHIPS.join('  ·  ')}</p>

      <Section n="01" label="At a glance" id="glance" title="Cheap to run, hard to fool." sub="Measured in the sandbox, not estimated: every number comes from the test suite or a worst-case run.">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="section-header">Gas per action · 0.0001 NEAR per Tgas</p>
            <Rows>
              {GLANCE.map((g) => (
                <li key={g.action} className="flex items-baseline justify-between gap-6 py-3">
                  <span>{g.action}</span>
                  <span className="shrink-0 font-mono text-sm text-label2">{g.gas} · {g.cost}</span>
                </li>
              ))}
            </Rows>
          </div>
          <div className="grid grid-cols-2 gap-x-6 self-end">
            {STATS.map((s) => (
              <div key={s.label} className="border-t border-sep py-4">
                <p className="text-5xl font-medium tracking-[-0.04em]">{s.n}</p>
                <p className="mt-2 text-sm text-label2">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section n="02" label="Three layers" id="layers" title="Check. Enforce. Explain." sub="Each layer works on its own; together the agent can only ask, never take.">
        <div className="grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-sep">
          {LAYERS.map((l, i) => (
            <article key={l.name} className="flex flex-col gap-4 md:px-6 md:first:pl-0 md:last:pr-0">
              <p className="mono-label">{pad(i)}</p>
              <h3 className="text-2xl font-medium tracking-[-0.02em]">{l.name}</h3>
              <p>{l.tagline}</p>
              <p className="flex-1 text-sm text-label2">{l.body}</p>
              <p className="font-mono text-xs text-label2">{l.chips.join(' / ')}</p>
              <Link href={l.href} className="ios-link">{l.cta} →</Link>
            </article>
          ))}
        </div>
      </Section>

      <Section n="03" label="How a payment flows" id="flow" title="Four steps, one signature.">
        <ol className="grid gap-8 md:grid-cols-4 md:gap-0 md:divide-x md:divide-sep">
          {STEPS.map((s, i) => (
            <li key={s.title} className="space-y-2 md:px-6 md:first:pl-0 md:last:pr-0">
              <p className="mono-label">{pad(i)}</p>
              <h3 className="font-medium">{s.title}</h3>
              <p className="text-sm text-label2">{s.body}</p>
            </li>
          ))}
        </ol>
        <Rows>
          {OUTCOMES.map(([v, t, d]) => (
            <li key={t} className="flex items-start gap-4 py-3">
              <Badge value={v} />
              <p className="text-sm"><span className="font-medium">{t}.</span> <span className="text-label2">{d}</span></p>
            </li>
          ))}
        </Rows>
      </Section>

      <Section n="04" label="The attack, replayed" id="attack" title="One injected invoice, five situations." sub="Run it yourself with pnpm demo:attack: local sandbox, no keys, no funds.">
        <Rows>
          {ACTS.map((a, i) => (
            <li key={a.tries} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
              <span className="mono-label w-6">{pad(i)}</span>
              <span className="min-w-[14rem] flex-1 font-medium">{a.tries}</span>
              <span className="flex-1 text-sm text-label2">{a.outcome}</span>
              <Badge value={a.verdict} />
            </li>
          ))}
        </Rows>
      </Section>

      <Section n="05" label="Built on NEAR" id="stack" title="What it stands on.">
        <div className="grid border-t border-sep md:grid-cols-2 md:gap-x-10">
          {STACK.map((s) => (
            <div key={s.name} className="flex items-start gap-4 border-b border-sep py-3">
              <div className="flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-sm text-label2">{s.what}</p>
              </div>
              {s.links.map(([label, href]) => (
                <a key={href} href={href} target="_blank" rel="noreferrer" className="ios-link font-mono text-xs">{label} ↗</a>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section n="06" label="Run it" id="run" title="Three commands, no wallet needed." sub="Real contracts and real token code in a local NEAR sandbox, with fake money.">
        <pre className="overflow-x-auto border border-sep p-5 font-mono text-sm leading-relaxed">{`pnpm install
pnpm demo:attack                  # the five situations above
pnpm dev:chain                    # sandbox for the dashboard
pnpm --filter @sentraio/web dev  # http://localhost:3000`}</pre>
      </Section>

      <Section n="07" label="Honest limits" id="limits" title="What it does not promise.">
        <Rows>
          {LIMITS.map((l, i) => (
            <li key={l} className="flex gap-6 py-3 text-sm">
              <span className="mono-label w-6 shrink-0 pt-0.5">{pad(i)}</span>
              <span className="text-label2">{l}</span>
            </li>
          ))}
        </Rows>
      </Section>

      <Section n="08" label="Questions" id="faq" title="Questions judges should ask.">
        <div className="divide-y divide-sep border-y border-sep">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 font-medium">
                {q}
                <span className="font-mono text-label3 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-2xl pb-5 text-sm text-label2">{a}</p>
            </details>
          ))}
        </div>
      </Section>
    </div>
  );
}
