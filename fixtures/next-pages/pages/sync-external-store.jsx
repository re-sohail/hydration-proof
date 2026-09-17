import { SyncExternalStoreControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>sync-external-store</h1>
      <SyncExternalStoreControl />
    </main>
  );
}
