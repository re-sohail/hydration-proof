import { InvalidNestingCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>invalid-nesting</h1>
      <InvalidNestingCase />
    </main>
  );
}
