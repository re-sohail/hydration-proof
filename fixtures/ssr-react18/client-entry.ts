import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { boot } from '../ssr-shared/client.ts';

boot(React as never, ReactDOMClient);
