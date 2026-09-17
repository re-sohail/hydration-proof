import { CdnWhitespaceCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>cdn-whitespace</h1>
      <CdnWhitespaceCase />
    </main>
  );
}
