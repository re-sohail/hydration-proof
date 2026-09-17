import { Coin } from './Coin.jsx';

export const dynamic = 'force-dynamic';

// Deliberately flaky: every other request renders a mismatch.
let requests = 0;

export default function Page() {
  requests += 1;
  return (
    <main>
      <h1>Flaky</h1>
      <Coin odd={requests % 2 === 1} />
    </main>
  );
}
