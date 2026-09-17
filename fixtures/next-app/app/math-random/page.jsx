import { MathRandomCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>math-random</h1>
      <MathRandomCase />
    </main>
  );
}
