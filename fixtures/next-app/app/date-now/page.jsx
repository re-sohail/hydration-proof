import { DateNowCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>date-now</h1>
      <DateNowCase />
    </main>
  );
}
