import { RandomInEffectControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>random-in-effect</h1>
      <RandomInEffectControl />
    </main>
  );
}
