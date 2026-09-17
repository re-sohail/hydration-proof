import { Suspense } from 'react';
import { ApiDataCase } from '@fixtures/next-cases';

export async function getServerSideProps({ req }) {
  return { props: { origin: `http://${req.headers.host}`, requestId: crypto.randomUUID() } };
}

export default function Page({ origin, requestId }) {
  return (
    <main>
      <h1>api-data</h1>
      <Suspense fallback={<p id="api-data-loading">Loading…</p>}>
        <ApiDataCase origin={origin} requestId={requestId} />
      </Suspense>
    </main>
  );
}
