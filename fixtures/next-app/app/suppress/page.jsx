import { SuppressControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>suppress</h1>
      <SuppressControl />
    </main>
  );
}
