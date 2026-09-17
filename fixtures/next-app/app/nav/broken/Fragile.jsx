'use client';

import { visits } from '../store.js';

// Deliberately broken for client navigation: throws when another page ran first.
export function Fragile() {
  if (visits.from !== null) throw new Error('Fragile only works when the page is loaded directly.');
  return <p id="nav-broken">Works when loaded directly</p>;
}
