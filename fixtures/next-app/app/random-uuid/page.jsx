import { RandomUuidCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>random-uuid</h1>
      <RandomUuidCase />
    </main>
  );
}
