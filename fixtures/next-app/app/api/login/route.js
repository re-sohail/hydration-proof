export async function POST(request) {
  const form = await request.formData();
  const role = form.get('role') === 'admin' ? 'admin' : 'customer';
  return new Response(null, {
    status: 303,
    headers: {
      location: role === 'admin' ? '/admin' : '/customer',
      'set-cookie': `session=${role}; Path=/; HttpOnly; SameSite=Lax`,
    },
  });
}
