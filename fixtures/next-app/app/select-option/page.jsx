import { SelectOptionCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>select-option</h1>
      <SelectOptionCase />
    </main>
  );
}
