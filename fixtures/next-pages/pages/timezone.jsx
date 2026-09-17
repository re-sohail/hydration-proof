import { TimezoneCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>timezone</h1>
      <TimezoneCase />
    </main>
  );
}
