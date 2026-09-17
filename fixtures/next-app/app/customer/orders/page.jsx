import { requireRole } from '../session.js';

export default async function Orders() {
  await requireRole('customer');
  return (
    <main>
      <h1>Orders</h1>
      <ul id="orders">
        <li>Order 1001</li>
        <li>Order 1002</li>
      </ul>
    </main>
  );
}
