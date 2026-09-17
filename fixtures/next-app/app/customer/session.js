import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function requireRole(role) {
  const session = (await cookies()).get('session')?.value;
  if (session !== role) redirect('/login');
  return session;
}
