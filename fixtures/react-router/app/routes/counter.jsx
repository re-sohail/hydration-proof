import { useState } from 'react';

export const meta = () => [{ title: 'Counter' }];

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button id="counter" type="button" onClick={() => setCount((c) => c + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
}
