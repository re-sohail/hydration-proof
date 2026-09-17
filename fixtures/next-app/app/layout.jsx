export const metadata = { title: 'hydration-proof fixture (App Router)' };

export default function RootLayout({ children }) {
  return (
    // next-themes style: the theme script may add a class before hydration.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
