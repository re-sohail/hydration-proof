export const meta = () => [{ title: 'Date.now()' }];

export default function DateNow() {
  return (
    <main>
      <p id="date-now">Rendered at {Date.now()}</p>
    </main>
  );
}
