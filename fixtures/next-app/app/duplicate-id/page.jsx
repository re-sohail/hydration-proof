// Two elements share an id (reported as info).
export default function Page() {
  return (
    <main>
      <h1>duplicate-id</h1>
      <p id="twice-used">First</p>
      <p id="twice-used">Second</p>
    </main>
  );
}
