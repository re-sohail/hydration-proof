import { SuppressControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>suppress</h1>
      <SuppressControl />
    </main>
  );
}
