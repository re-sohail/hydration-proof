import { TextareaValueCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>textarea-value</h1>
      <TextareaValueCase />
    </main>
  );
}
