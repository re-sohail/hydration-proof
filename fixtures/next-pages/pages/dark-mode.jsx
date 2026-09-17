import { DarkModeCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>dark-mode</h1>
      <DarkModeCase />
    </main>
  );
}
