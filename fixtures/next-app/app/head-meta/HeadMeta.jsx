'use client';

// Deliberately broken: React 19 hoists these into <head>, with different
// values on the server and in the browser.
export function HeadMeta() {
  const side = typeof window === 'undefined' ? 'server' : 'client';
  return (
    <>
      <title>{`Head meta (${side})`}</title>
      <meta name="description" content={`Rendered on the ${side}`} />
      <p id="head-meta">The page title and description differ.</p>
    </>
  );
}
