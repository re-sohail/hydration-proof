import { SelectOptionCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>select-option</h1>
      <SelectOptionCase />
    </main>
  );
}
