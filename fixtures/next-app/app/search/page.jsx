export default async function Search({ searchParams }) {
  const { q = '' } = await searchParams;
  return (
    <main>
      <h1>Search</h1>
      <p id="query">{q ? `Results for ${q}` : 'Type something to search.'}</p>
    </main>
  );
}
