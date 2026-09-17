'use client';

import { visits } from '../store.js';

// Deliberately broken for client navigation: reads state the previous page left.
export function CameFrom() {
  return <p id="came-from">Came from {visits.from ?? 'a direct load'}</p>;
}
