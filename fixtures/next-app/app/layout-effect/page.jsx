import { LayoutEffectControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>layout-effect</h1>
      <LayoutEffectControl />
    </main>
  );
}
