import { AttrMismatchCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>attr-mismatch</h1>
      <AttrMismatchCase />
    </main>
  );
}
