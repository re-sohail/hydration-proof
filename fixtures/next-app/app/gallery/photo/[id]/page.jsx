export default async function Photo({ params }) {
  const { id } = await params;
  return (
    <main>
      <h1 id="photo">Photo {id}</h1>
    </main>
  );
}
