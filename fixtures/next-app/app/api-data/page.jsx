import { headers } from 'next/headers';
import { Suspense } from 'react';
import { ApiDataCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const host = (await headers()).get('host');
  return (
    <main>
      <h1>api-data</h1>
      <Suspense fallback={<p id="api-data-loading">Loading…</p>}>
        <ApiDataCase origin={`http://${host}`} requestId={crypto.randomUUID()} />
      </Suspense>
    </main>
  );
}
