import Link from 'next/link';
import { MarkSource } from './MarkSource.jsx';

export default function Page() {
  return (
    <main>
      <h1>nav-source</h1>
      <MarkSource />
      <Link href="/nav/target">target</Link>
    </main>
  );
}
