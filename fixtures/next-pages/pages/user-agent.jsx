import { UserAgentCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>user-agent</h1>
      <UserAgentCase />
    </main>
  );
}
