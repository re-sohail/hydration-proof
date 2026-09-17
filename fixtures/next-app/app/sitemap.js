// Sitemaps list the production domain; hydration-proof maps them to the tested host.
export default function sitemap() {
  return [
    { url: 'https://example.com/' },
    { url: 'https://example.com/static' },
    { url: 'https://example.com/search?q=sitemap' },
  ];
}
