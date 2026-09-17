import { RandomInEffectControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>random-in-effect</h1>
      <RandomInEffectControl />
    </main>
  );
}
