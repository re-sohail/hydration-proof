import { DangerousHtmlCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>dangerous-html</h1>
      <DangerousHtmlCase />
    </main>
  );
}
