import { LocalStorageCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>local-storage</h1>
      <LocalStorageCase />
    </main>
  );
}
