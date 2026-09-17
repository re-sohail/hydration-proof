import { CdnWhitespaceCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>cdn-whitespace</h1>
      <CdnWhitespaceCase />
    </main>
  );
}
