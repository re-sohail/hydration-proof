import { MathRandomCase } from '@fixtures/next-cases';

export function getServerSideProps() {
  return { props: {} };
}

export default function Page() {
  return (
    <main>
      <h1>math-random</h1>
      <MathRandomCase />
    </main>
  );
}
