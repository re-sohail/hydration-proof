// Usage: NODE_ENV=production PORT=0 node serve.ts
// Prints "ready <url>" once listening.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startHarness } from '../ssr-shared/server.ts';

const require = createRequire(import.meta.url);
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const { url } = await startHarness(
  {
    React,
    ReactDOMServer,
    clientFile: join(import.meta.dirname, 'dist', `client.${mode}.js`),
    label: `react19-${mode}`,
  },
  Number(process.env.PORT ?? 0),
);
console.log(`ready ${url}`);
