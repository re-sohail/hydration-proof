import { UseIdControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>use-id</h1>
      <UseIdControl />
    </main>
  );
}
