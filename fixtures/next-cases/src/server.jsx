// Server-safe pieces (no 'use client').

export function StaticControl() {
  return (
    <article id="static">
      <h2>Static content</h2>
      <p>Nothing here depends on the environment.</p>
    </article>
  );
}

export async function SlowServerData() {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return <p id="streamed">Streamed after a delay</p>;
}
