'use client';

export function Coin({ odd }) {
  const side = odd && typeof window !== 'undefined' ? 'tails' : 'heads';
  return <p id="coin">Coin: {side}</p>;
}
