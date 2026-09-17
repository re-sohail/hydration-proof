import { StyleMismatchCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>style-mismatch</h1>
      <StyleMismatchCase />
    </main>
  );
}
