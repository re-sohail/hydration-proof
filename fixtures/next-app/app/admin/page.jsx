import { requireRole } from '../customer/session.js';
import { AdminStats } from './AdminStats.jsx';

export default async function Admin() {
  await requireRole('admin');
  return (
    <main>
      <h1>Admin</h1>
      <AdminStats />
    </main>
  );
}
