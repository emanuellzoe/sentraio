import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <h1 className="font-pixel text-5xl leading-tight md:text-6xl">
          A guard for AI agents
          <br />
          that hold money.
        </h1>
        <p className="max-w-2xl text-lg">
          Sentineli checks who your agent is about to pay, simulates the payment against real chain state,
          and only lets an on-chain vault move funds with its signed approval.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/faillens" className="px-btn">Open FailLens</Link>
          <Link href="/preflight" className="px-btn">Try Preflight</Link>
        </div>
      </section>
      <section className="dither-25 px-frame p-6">
        <p className="inline-block bg-paper px-2 font-pixel text-sm">More here soon<span className="cursor" /></p>
      </section>
    </div>
  );
}
