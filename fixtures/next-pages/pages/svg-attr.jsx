import { SvgAttrCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>svg-attr</h1>
      <SvgAttrCase />
    </main>
  );
}
