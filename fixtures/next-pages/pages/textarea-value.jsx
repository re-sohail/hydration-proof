import { TextareaValueCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>textarea-value</h1>
      <TextareaValueCase />
    </main>
  );
}
