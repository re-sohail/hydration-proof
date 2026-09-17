import { renderToPipeableStream } from 'react-dom/server';
import { App, matchRoute } from './pages.jsx';

export { matchRoute };

export function render(pathname, options) {
  return renderToPipeableStream(<App pathname={pathname} />, options);
}
