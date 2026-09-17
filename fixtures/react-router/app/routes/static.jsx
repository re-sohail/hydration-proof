export const meta = () => [{ title: 'Static' }];

export default function Static() {
  return (
    <main>
      <h1 id="static">Static page</h1>
      <p>This text is the same on the server and in the browser.</p>
    </main>
  );
}
