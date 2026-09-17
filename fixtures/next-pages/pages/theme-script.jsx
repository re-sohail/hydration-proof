import { ThemeScriptControl } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>theme-script</h1>
      <ThemeScriptControl />
    </main>
  );
}
