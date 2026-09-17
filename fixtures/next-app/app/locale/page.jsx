import { LocaleCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>locale</h1>
      <LocaleCase />
    </main>
  );
}
