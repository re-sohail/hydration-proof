import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button id="counter" type="button" onClick={() => setCount((c) => c + 1)}>
      Clicked {count} times
    </button>
  );
}
