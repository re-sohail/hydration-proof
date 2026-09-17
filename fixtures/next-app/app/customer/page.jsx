import { requireRole } from './session.js';

export default async function CustomerHome() {
  await requireRole('customer');
  return (
    <main>
      <h1>Customer dashboard</h1>
      <p id="welcome">Welcome back.</p>
      <a href="/customer/orders">Your orders</a>
    </main>
  );
}
