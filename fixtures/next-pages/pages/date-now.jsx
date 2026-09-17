import { DateNowCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>date-now</h1>
      <DateNowCase />
    </main>
  );
}
