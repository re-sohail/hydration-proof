import { SvgAttrCase } from '@fixtures/next-cases';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <h1>svg-attr</h1>
      <SvgAttrCase />
    </main>
  );
}
