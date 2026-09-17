import { MatchMediaCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>match-media</h1>
      <MatchMediaCase />
    </main>
  );
}
