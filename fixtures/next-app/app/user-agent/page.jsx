import { UserAgentCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>user-agent</h1>
      <UserAgentCase />
    </main>
  );
}
