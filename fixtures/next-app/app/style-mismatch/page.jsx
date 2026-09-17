import { StyleMismatchCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>style-mismatch</h1>
      <StyleMismatchCase />
    </main>
  );
}
