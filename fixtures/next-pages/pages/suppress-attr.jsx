import { SuppressAttrControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>suppress-attr</h1>
      <SuppressAttrControl />
    </main>
  );
}
