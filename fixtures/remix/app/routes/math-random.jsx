export const meta = () => [{ title: 'Math.random()' }];

export default function MathRandom() {
  return (
    <main>
      <p id="math-random">Lucky number {Math.random().toFixed(8)}</p>
    </main>
  );
}
