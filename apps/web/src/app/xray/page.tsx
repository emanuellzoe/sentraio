import type { Metadata } from 'next';
import { Suspense } from 'react';
import { XRay } from './xray';

export const metadata: Metadata = { title: 'Tx X-Ray — Sentraio' };

export default function XRayPage() {
  return (
    <div className="space-y-8">
      <div className="fade-in space-y-3">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Tx X-Ray</h1>
        <p className="max-w-3xl text-lg text-label2">
          A NEAR transaction can say <b>success</b> while a receipt inside it failed. Tx X-Ray reads every receipt,
          explains failures in plain words, and tells you where the money actually is now.
        </p>
      </div>
      <Suspense fallback={<div className="ios-card h-40 animate-pulse" />}>
        <XRay />
      </Suspense>
    </div>
  );
}
