import { CssInJsCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>css-in-js</h1>
      <CssInJsCase />
    </main>
  );
}
