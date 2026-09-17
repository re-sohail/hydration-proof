import { AttrMismatchCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>attr-mismatch</h1>
      <AttrMismatchCase />
    </main>
  );
}
