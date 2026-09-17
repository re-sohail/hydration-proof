import { nextVisit } from '@fixtures/next-cases/counter';

export default function handler(_req, res) {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ count: nextVisit() });
}
