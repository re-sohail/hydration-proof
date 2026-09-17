import { PortalControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>portal</h1>
      <PortalControl />
    </main>
  );
}
