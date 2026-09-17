import { CssInJsCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>css-in-js</h1>
      <CssInJsCase />
    </main>
  );
}
