import Link from 'next/link';
import { RotatingLine } from '@/components/landing';
import { PixelShield } from '@/components/pixel-shield';
import { Badge } from '@/components/verdict';

// ---------------------------------------------------------------- content
// Numbers come from the test suite and sandbox runs (see contracts/, packages/, demo/attack/).

const TICKER = ['Rules on-chain', 'Reasons in plain words', 'Allow signs', 'Warn asks a human', 'Block refuses', 'Nothing moves without a signature', 'Panic in one click'];

const GLANCE = [
  { action: 'Agent payment (execute)', gas: '6.9 Tgas', cost: '~0.0007 NEAR' },
  { action: 'Payment with Preflight signature', gas: '7.2 Tgas', cost: '~0.0007 NEAR' },
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
    code: 'PRE', name: 'Preflight', tagline: 'Who is being paid, and what will really happen?',
    body: 'Checks the receiver and the token before anything is signed, then simulates the payment on real contract code with real balances in a sandbox.',
    chips: ['Look-alike names', 'Registry', 'Code changes', 'Simulation'], href: '/preflight', cta: 'Try Preflight',
  },
  {
    code: 'VLT', name: 'Vault', tagline: 'The mandate the agent cannot step outside of.',
    body: 'On-chain limits per transaction and per day, single-use Preflight signatures, strikes that auto-freeze, and a constant-gas panic switch. Native NEAR included.',
    chips: ['Limits', 'Approvals', 'Auto-freeze', 'Panic'], href: '/vault', cta: 'Open the vault',
  },
  {
    code: 'FLN', name: 'FailLens', tagline: 'Success on top, failure inside? It tells you.',
    body: 'Reads every receipt of any NEAR transaction, explains each failure with a fix, and shows where the funds actually are now.',
    chips: ['Receipt tree', 'Fix hints', 'Funds now', 'Testnet + mainnet'], href: '/faillens', cta: 'Explain a transaction',
  },
];

const STEPS = [
  { title: 'Agent plans', body: 'The LLM decides to pay. It holds only a function-call key for vault.execute.' },
  { title: 'Preflight checks', body: 'Nine signals, worst wins. Allow signs, warn waits for an operator, block refuses.' },
  { title: 'Vault enforces', body: 'Limits, receiver rules and a valid, unused signature, or nothing moves.' },
  { title: 'FailLens explains', body: 'Every outcome comes back as a plain-language report with the funds trail.' },
];

const ACTS = [
  { tries: 'Injected invoice, plain wallet key', verdict: 'failed', outcome: 'Attacker +5 NEAR.' },
  { tries: 'Honest invoice, through Sentineli', verdict: 'allow', outcome: 'Shop +2 NEAR, explained.' },
  { tries: 'Same injected invoice, through Sentineli', verdict: 'block', outcome: 'shop-payrnents ≈ shop-payments. Attacker +0.' },
  { tries: 'Compromised code calls the vault', verdict: 'block', outcome: 'Approval missing or forged. The key cannot move NEAR.' },
  { tries: 'First order from a new vendor', verdict: 'warn', outcome: 'Operator confirms, then it pays.' },
];

const STACK: { name: string; what: string; links: [string, string][] }[] = [
  { name: 'near-sdk (Rust)', what: 'Vault and registry contracts, pinned to build for mainnet protocol 86.', links: [['Docs', 'https://docs.near.org/smart-contracts/what-is']] },
  { name: 'near-workspaces sandbox', what: 'Preflight simulation and every end-to-end test.', links: [['Git', 'https://github.com/near/near-workspaces-js']] },
  { name: 'NEP-141 / NEP-297', what: 'Token transfers and event logs that the vault and FailLens speak.', links: [['Spec', 'https://nomicon.io/Standards/Tokens/FungibleToken/Core']] },
  { name: 'Function-call keys', what: 'The agent key: one contract, one method, gas-only allowance.', links: [['Docs', 'https://docs.near.org/protocol/access-keys']] },
  { name: 'NearBlocks API', what: 'Receiver age and activity signals.', links: [['API', 'https://api.nearblocks.io/api-docs']] },
  { name: 'FastNEAR RPC', what: 'Regular and archival nodes, so FailLens also reads old transactions.', links: [['Site', 'https://fastnear.com']] },
  { name: 'Agent API', what: 'Spending policy for agents. Sentineli covers what it does not: counterparties, simulation, native methods.', links: [['Docs', 'https://docs.agentsonintents.com']] },
  { name: 'NEAR AI Cloud', what: 'Optional real LLM for the attack demo (OpenAI-compatible).', links: [['Docs', 'https://docs.near.ai']] },
];

const LIMITS = [
  'Simulation fully reproduces standard NEP-141 tokens; contracts with too much state (big DEXes) run partially, and Preflight says so with a warn.',
  'Approvals are single-use and expire within 10 minutes: this narrows, but does not remove, the gap between simulation and execution.',
  'Registry “blocked” needs a moderator. Many community reports only make an account “suspected”, so sybils cannot hard-block anyone.',
  'A function-call key’s allowance pays gas only and cannot be topped up; the owner keeps the full-access key to rotate it.',
];

const FAQ: [string, string][] = [
  ['Isn’t this what NEAR’s Agent API already does?', 'The Agent API caps spending and can freeze an agent, but its policy does not protect native methods and it does not ask who is being paid. Sentineli adds the counterparty check, simulation, a vault that covers native transfers, and the failure explainer. Use both.'],
  ['What if a prompt injection takes over the agent?', 'The agent can still only ask. Preflight blocks look-alike or reported receivers, and the vault refuses any call without a valid, unused Preflight signature. The agent’s key cannot transfer NEAR or add keys.'],
  ['Can the agent approve its own warning?', 'No. The agent token can only request checks; approving a warn needs the separate operator token, and the decision records who made it.'],
  ['What if the guardian (Preflight) key leaks?', 'An attacker could sign approvals, but only inside the owner’s mandate: limits and receiver rules are enforced by the contract. The owner rotates the guardian or hits Panic.'],
  ['What happens when a transfer fails?', 'The vault puts the amount back into its ledger and the daily budget. FailLens shows the failed receipt, the refund and where the funds are. Untracked tokens can be recovered with sync_balance.'],
  ['Can attackers knock the contracts over with bots?', 'Every caller pays their own gas and cannot grow the vault’s state. Loops are bounded (10 tokens, 50 receivers), and Panic costs the same however many agents exist.'],
];

// ---------------------------------------------------------------- pieces

function SectionHead({ n, label, title, sub, id }: { n: string; label: string; title: [string, string]; sub?: string; id: string }) {
  return (
    <header id={id} className="scroll-mt-24 space-y-3">
      <p className="font-pixel text-xs">{n} / {label.toUpperCase()}</p>
      <h2 className="font-pixel text-3xl leading-tight uppercase md:text-4xl">
        {title[0]}
        <br />
        {title[1]}
      </h2>
      <p aria-hidden className="font-pixel text-sm tracking-[0.3em]">-----</p>
      {sub && <p className="max-w-2xl">{sub}</p>}
    </header>
  );
}

/** Full-bleed band that escapes the page's max-width container. */
const bleed = 'relative left-1/2 w-screen -translate-x-1/2';

function Ticker() {
  const row = TICKER.map((t) => `${t.toUpperCase()}  ✳  `).join('');
  return (
    <div className={`${bleed} overflow-hidden border-y-2 border-ink bg-ink py-2 text-paper`} aria-label={TICKER.join(', ')}>
      <div className="ticker-track flex w-max font-pixel text-sm whitespace-pre" aria-hidden>
        <span>{row}</span>
        <span>{row}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export default function Home() {
  return (
    <div className="space-y-24">
      {/* hero */}
      <section>
        <div className="grid items-center gap-10 pb-12 md:grid-cols-[1.35fr_1fr]">
          <div className="space-y-6">
            <p className="font-pixel text-xs">[ SENTINELI / AGENT SECURITY ON NEAR ]</p>
            <h1 className="text-4xl leading-tight md:text-5xl">
              AI agents can hold money now. <b className="font-pixel text-[0.85em] leading-snug">Sentineli decides what they may do with it.</b>
            </h1>
            <RotatingLine items={['checks who gets paid', 'simulates the payment', 'gates the vault on-chain', 'asks a human when unsure', 'explains every failure']} />
            <p className="max-w-xl">
              A prompt-injected agent will try to pay the wrong account.
              <br />
              <b>With Sentineli, the money stays where it is.</b>
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#layers" className="px-btn">Explore the layers</a>
              <Link href="/vault" className="px-btn px-btn-solid">Try the attack →</Link>
            </div>
          </div>
          <div className="px-frame bg-paper p-4">
            <PixelShield />
            <p className="mt-2 border-t-2 border-ink pt-2 font-pixel text-xs">Attacks in · nothing through</p>
          </div>
        </div>
        <Ticker />
      </section>

      {/* 00 */}
      <section className="space-y-8">
        <div className="grid gap-8 md:grid-cols-2">
          <SectionHead id="glance" n="00" label="At a glance" title={['Cheap to run,', 'hard to fool']} />
          <p className="self-end">
            Measured in the sandbox, not estimated. Every number comes from the test suite or the worst-case run with the
            maximum number of tokens and receivers.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="px-frame bg-paper">
            <p className="border-b-2 border-ink px-4 py-2 font-pixel text-xs">[ GAS PER ACTION · 0.0001 NEAR PER TGAS ]</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left font-pixel text-xs"><th className="p-3">Action</th><th className="p-3">Gas</th><th className="p-3">Cost</th></tr>
              </thead>
              <tbody>
                {GLANCE.map((g) => (
                  <tr key={g.action} className="border-b border-ink last:border-0">
                    <td className="p-3">{g.action}</td>
                    <td className="p-3 whitespace-nowrap">{g.gas}</td>
                    <td className="p-3 whitespace-nowrap">{g.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="px-frame-sm bg-paper p-4">
                <p className="font-pixel text-4xl">{s.n}</p>
                <p className="text-xs">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 01 */}
      <section className="space-y-8">
        <SectionHead id="layers" n="01" label="Three layers" title={['Check, enforce,', 'explain']} sub="Each layer works on its own; together the agent can only ask, never take." />
        <div className="grid gap-6 md:grid-cols-3">
          {LAYERS.map((l, i) => (
            <article key={l.code} className="px-frame flex flex-col bg-paper">
              <div className="flex items-start justify-between border-b-2 border-ink p-4">
                <span className="font-pixel text-xs">[ 0{i + 1} / {l.code} ]</span>
                <span className="font-pixel text-5xl leading-none">0{i + 1}</span>
              </div>
              <div className="flex-1 space-y-3 p-4">
                <h3 className="font-pixel text-xl">{l.name}</h3>
                <p className="italic">{l.tagline}</p>
                <p className="text-sm">{l.body}</p>
                <div className="flex flex-wrap gap-2">
                  {l.chips.map((c) => <span key={c} className="border-2 border-ink px-2 font-pixel text-[10px] uppercase">{c}</span>)}
                </div>
              </div>
              <div className="border-t-2 border-ink p-4">
                <Link href={l.href} className="px-btn inline-block">{l.cta} →</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 02 */}
      <section className="space-y-8">
        <SectionHead id="flow" n="02" label="How a payment flows" title={['Four steps,', 'one signature']} />
        <ol className="grid gap-6 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="space-y-2 border-t-4 border-ink pt-4">
              <p className="font-pixel text-5xl leading-none">0{i + 1}</p>
              <h3 className="font-pixel text-lg">{s.title}</h3>
              <p className="text-sm">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="grid gap-4 text-sm md:grid-cols-3">
          <div className="hatch border-2 border-ink p-2"><p className="bg-paper p-3"><b>✗ block</b>: Preflight never signs; the guard refuses.</p></div>
          <div className="dither-25 border-2 border-ink p-2"><p className="bg-paper p-3"><b>! warn</b>: an operator decides; the agent token cannot approve itself.</p></div>
          <div className="hatch border-2 border-ink p-2"><p className="bg-paper p-3"><b>✗ bypass</b>: the vault rejects calls without a valid, unused signature.</p></div>
        </div>
      </section>

      {/* 03 */}
      <section className="space-y-8">
        <SectionHead id="attack" n="03" label="The attack, replayed" title={['One injected invoice,', 'five situations']} sub="Run it yourself with pnpm demo:attack: local sandbox, no keys, no funds." />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {ACTS.map((a, i) => (
            <article key={a.tries} className="px-frame-sm flex flex-col gap-3 bg-paper p-4">
              <div className="flex items-center justify-between">
                <span className="font-pixel text-xs">[ 0{i + 1} ]</span>
                <Badge value={a.verdict} />
              </div>
              <p className="font-semibold">{a.tries}</p>
              <p className="mt-auto text-sm">{a.outcome}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 04 */}
      <section className="space-y-8">
        <SectionHead id="stack" n="04" label="Built on NEAR" title={['What it', 'stands on']} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STACK.map((s) => (
            <article key={s.name} className="flex flex-col gap-2 border-2 border-ink p-4">
              <h3 className="font-pixel text-sm">{s.name}</h3>
              <p className="flex-1 text-sm">{s.what}</p>
              <p className="flex gap-3 text-xs">
                {s.links.map(([label, href]) => (
                  <a key={href} href={href} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-2 hover:bg-ink hover:text-paper">{label} ↗</a>
                ))}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* 05 */}
      <section className="space-y-8">
        <SectionHead id="run" n="05" label="Run it" title={['Three commands,', 'no wallet needed']} />
        <div className="px-frame grid gap-6 bg-ink p-6 text-paper md:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4">
            <p className="font-pixel text-xs">[ START HERE ]</p>
            <p>Everything runs against a local NEAR sandbox: real contracts, real token code, fake money.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/vault" className="px-btn text-ink">Open the dashboard</Link>
              <Link href="/faillens" className="border-2 border-paper px-4 py-2 font-pixel uppercase hover:bg-paper hover:text-ink">FailLens</Link>
            </div>
          </div>
          <pre className="overflow-x-auto text-sm leading-relaxed">{`pnpm install
pnpm demo:attack                  # the five situations above
pnpm dev:chain                    # sandbox for the dashboard
pnpm --filter @sentineli/web dev  # http://localhost:3000`}</pre>
        </div>
      </section>

      {/* limits band */}
      <section className={`${bleed} dither-25 border-y-2 border-ink py-12`}>
        <div className="mx-auto max-w-6xl px-5">
          <div className="px-frame space-y-6 bg-paper p-6">
            <p className="font-pixel text-xs">[ HONEST LIMITS ]</p>
            <h2 className="font-pixel text-3xl leading-tight uppercase">What it does not<br />promise</h2>
            <ul className="grid gap-4 text-sm md:grid-cols-2">
              {LIMITS.map((l) => <li key={l} className="border-l-4 border-ink pl-3">{l}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* 06 */}
      <section className="space-y-8">
        <SectionHead id="faq" n="06" label="Frequent queries" title={['Questions judges', 'should ask']} />
        <div className="border-t-2 border-ink">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-b-2 border-ink">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold hover:bg-ink hover:text-paper">
                <span className="px-2">{q}</span>
                <span className="px-2 font-pixel group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-3xl px-2 pb-5 text-sm">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* sticky demo bar */}
      {/* sticky needs its own box: the full-bleed trick uses relative positioning */}
      <div className="sticky bottom-0 z-10">
        <div className={`${bleed} border-t-2 border-ink bg-paper`}>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-2">
            <p className="font-pixel text-xs">[ LIVE DEMO ] Play the agent and watch what gets through</p>
            <Link href="/vault" className="px-btn py-1 text-xs">Try the attack →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
