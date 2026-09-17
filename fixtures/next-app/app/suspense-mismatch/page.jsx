import { Suspense } from 'react';
import { BoundaryValue } from './BoundaryValue.jsx';

export const dynamic = 'force-dynamic';

async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return <BoundaryValue />;
}

// Deliberately broken inside one streamed Suspense boundary only.
export default function Page() {
  return (
    <main>
      <h1>suspense-mismatch</h1>
      <p id="outside">Outside the boundary</p>
      <Suspense fallback={<p id="suspense-fallback">Loading…</p>}>
        <Slow />
      </Suspense>
    </main>
  );
}
