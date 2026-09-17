import { nextVisit } from '@fixtures/next-cases/counter';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ count: nextVisit() }, { headers: { 'cache-control': 'no-store' } });
}
