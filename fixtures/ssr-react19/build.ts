import { buildClients } from '../ssr-shared/build.ts';

await buildClients(import.meta.dirname);
