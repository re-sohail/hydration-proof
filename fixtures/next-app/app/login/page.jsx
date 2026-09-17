export default function Login() {
  return (
    <main>
      <h1>Sign in</h1>
      <form method="post" action="/api/login">
        <label>
          Account
          <select id="role" name="role" defaultValue="customer">
            <option value="customer">Customer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button id="sign-in" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
