import { SuppressAttrControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>suppress-attr</h1>
      <SuppressAttrControl />
    </main>
  );
}
