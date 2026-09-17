import { MatchMediaCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>match-media</h1>
      <MatchMediaCase />
    </main>
  );
}
