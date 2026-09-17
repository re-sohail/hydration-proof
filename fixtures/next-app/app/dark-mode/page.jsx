import { DarkModeCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>dark-mode</h1>
      <DarkModeCase />
    </main>
  );
}
