import { ThemeScriptControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>theme-script</h1>
      <ThemeScriptControl />
    </main>
  );
}
