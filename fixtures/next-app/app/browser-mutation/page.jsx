import { BrowserMutationCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>browser-mutation</h1>
      <BrowserMutationCase />
    </main>
  );
}
