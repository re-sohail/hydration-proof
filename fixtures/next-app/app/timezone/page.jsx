import { TimezoneCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>timezone</h1>
      <TimezoneCase />
    </main>
  );
}
