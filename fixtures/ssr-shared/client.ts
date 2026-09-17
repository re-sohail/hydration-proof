// Client entry, bundled once per React version and mode.
import { createPages, type ReactLike } from './pages.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function boot(React: ReactLike, ReactDOMClient: any): void {
  const pages = createPages(React);
  const name = (window as any).__PAGE__ as string;
  const page = pages[name];
  const container = document.getElementById('root');
  if (!page || !container) return;
  const element = React.createElement(page.App);
  if (page.clientOnly) ReactDOMClient.createRoot(container).render(element);
  else ReactDOMClient.hydrateRoot(container, element);
  const second = document.getElementById('root2');
  if (page.second && second) {
    ReactDOMClient.hydrateRoot(second, React.createElement(page.second), page.secondPrefix ? { identifierPrefix: page.secondPrefix } : {});
  }
}
