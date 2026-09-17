import { hydrateRoot } from 'react-dom/client';
import { App } from './pages.jsx';

hydrateRoot(document.getElementById('root'), <App pathname={location.pathname} />);
