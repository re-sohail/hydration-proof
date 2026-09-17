'use client';

import { useEffect } from 'react';
import { visits } from '../store.js';

export function MarkSource() {
  useEffect(() => {
    visits.from = 'the source page';
  }, []);
  return <p id="nav-source">Navigate from here.</p>;
}
