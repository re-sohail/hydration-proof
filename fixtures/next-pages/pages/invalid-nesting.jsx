import { InvalidNestingCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>invalid-nesting</h1>
      <InvalidNestingCase />
    </main>
  );
}
