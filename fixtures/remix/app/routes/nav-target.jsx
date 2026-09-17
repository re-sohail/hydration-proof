import { visits } from '../visits.js';

export const meta = () => [{ title: 'Navigation target' }];

export default function NavTarget() {
  return (
    <main>
      <p id="came-from">Came from {visits.from ?? 'a direct load'}</p>
    </main>
  );
}
