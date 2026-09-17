import { SyncExternalStoreControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>sync-external-store</h1>
      <SyncExternalStoreControl />
    </main>
  );
}
