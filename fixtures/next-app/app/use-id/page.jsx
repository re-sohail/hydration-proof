import { UseIdControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>use-id</h1>
      <UseIdControl />
    </main>
  );
}
