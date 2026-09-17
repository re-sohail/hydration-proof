import { LocaleCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>locale</h1>
      <LocaleCase />
    </main>
  );
}
