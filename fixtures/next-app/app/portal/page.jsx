import { PortalControl } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>portal</h1>
      <PortalControl />
    </main>
  );
}
