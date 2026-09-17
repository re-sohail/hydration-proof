import { DangerousHtmlCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>dangerous-html</h1>
      <DangerousHtmlCase />
    </main>
  );
}
