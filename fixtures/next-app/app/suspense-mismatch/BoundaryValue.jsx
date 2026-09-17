'use client';

export function BoundaryValue() {
  return <p id="suspense-mismatch">Rendered on the {typeof window === 'undefined' ? 'server' : 'client'}</p>;
}
