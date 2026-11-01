import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FailLens } from './faillens';

export const metadata: Metadata = { title: 'FailLens — Sentineli' };

export default function FailLensPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="font-pixel text-4xl">FailLens</h1>
        <p className="max-w-3xl">
          A NEAR transaction can say <b>success</b> while a receipt inside it failed. FailLens reads every receipt,
          explains failures in plain words, and tells you where the money actually is now.
        </p>
      </div>
      <Suspense fallback={<div className="dither-25 px-frame h-40" />}>
        <FailLens />
      </Suspense>
    </div>
  );
}
