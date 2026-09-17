'use client';

import { useState } from 'react';

// A click before hydration is lost (the page looks ready before it is).
export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button id="counter" type="button" onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  );
}
