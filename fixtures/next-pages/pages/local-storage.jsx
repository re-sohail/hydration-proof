import { LocalStorageCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>local-storage</h1>
      <LocalStorageCase />
    </main>
  );
}
