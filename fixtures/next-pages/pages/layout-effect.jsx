import { LayoutEffectControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>layout-effect</h1>
      <LayoutEffectControl />
    </main>
  );
}
