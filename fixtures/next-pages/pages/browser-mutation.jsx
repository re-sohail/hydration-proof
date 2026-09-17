import { BrowserMutationCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>browser-mutation</h1>
      <BrowserMutationCase />
    </main>
  );
}
