import { RandomUuidCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>random-uuid</h1>
      <RandomUuidCase />
    </main>
  );
}
