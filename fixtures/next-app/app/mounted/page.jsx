import { MountedControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>mounted</h1>
      <MountedControl />
    </main>
  );
}
