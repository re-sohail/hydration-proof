import { MountedControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>mounted</h1>
      <MountedControl />
    </main>
  );
}
