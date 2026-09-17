import { Suspense } from 'react';
import { SlowServerData } from '@fixtures/next-cases/server';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>streaming</h1>
      <Suspense fallback={<p id="streamed-fallback">Loading…</p>}>
        <SlowServerData />
      </Suspense>
    </main>
  );
}
