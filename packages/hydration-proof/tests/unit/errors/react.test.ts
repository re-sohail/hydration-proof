import { describe, expect, it } from 'vitest';
import { classifyReactMessage, componentFrames, parseComponentStack, parseReactDiff } from '../../../src/errors/react.ts';

const REACT_19_TEXT = `Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

- A server/client branch \`if (typeof window !== 'undefined')\`.

https://react.dev/link/hydration-mismatch

  <App>
    <Layout>
      <main className="layout">
        <h1>
        <p id="env">
+         client
-         server
`;

describe('classifyReactMessage', () => {
  it('decodes production error codes and their arguments', () => {
    expect(
      classifyReactMessage(
        'Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]=%0A%2B%20client for the full message',
      ),
    ).toEqual({ kind: 'hydration-failed', code: 418, args: ['text', '\n+ client'], production: true });
    expect(classifyReactMessage('Minified React error #425; visit https://reactjs.org/docs/error-decoder.html?invariant=425 for the full message')).toMatchObject({
      kind: 'text-mismatch',
      code: 425,
    });
    expect(classifyReactMessage('Minified React error #423; visit …')).toMatchObject({ kind: 'root-client-render' });
    expect(classifyReactMessage('Minified React error #422;')).toMatchObject({ kind: 'boundary-client-render' });
    expect(classifyReactMessage('Minified React error #419;')).toMatchObject({ kind: 'server-render-failed' });
    expect(classifyReactMessage('Minified React error #421;')).toMatchObject({ kind: 'early-update' });
    expect(classifyReactMessage('Minified React error #31; visit')).toBeUndefined();
  });

  it('parses the React 19 development diff', () => {
    const message = classifyReactMessage(REACT_19_TEXT);
    expect(message?.kind).toBe('hydration-failed');
    expect(message?.diff?.filter((line) => line.sign !== ' ')).toEqual([
      { sign: '+', depth: 5, text: 'client' },
      { sign: '-', depth: 5, text: 'server' },
    ]);
    expect(parseReactDiff('no link here')).toBeUndefined();
  });

  it('recognises React 19 development warnings', () => {
    expect(
      classifyReactMessage("A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up."),
    ).toMatchObject({ kind: 'attribute-warning' });
    expect(classifyReactMessage('In HTML, <div> cannot be a descendant of <p>.\nThis will cause a hydration error.')).toMatchObject({
      kind: 'nesting-warning',
      childTag: 'div',
      parentTag: 'p',
    });
    expect(
      classifyReactMessage('There was an error while hydrating but React was able to recover by instead client rendering the entire root.'),
    ).toMatchObject({ kind: 'root-client-render' });
  });

  it('recognises React 18 development warnings with values', () => {
    expect(classifyReactMessage('Warning: Text content did not match. Server: "server" Client: "client"\n    at p')).toEqual({
      kind: 'text-warning',
      production: false,
      server: 'server',
      client: 'client',
    });
    expect(classifyReactMessage('Warning: Prop `className` did not match. Server: "a" Client: "b"\n    at div')).toEqual({
      kind: 'attribute-warning',
      production: false,
      prop: 'className',
      server: 'a',
      client: 'b',
    });
    expect(classifyReactMessage('Warning: validateDOMNesting(...): <div> cannot appear as a descendant of <p>.')).toMatchObject({
      kind: 'nesting-warning',
      childTag: 'div',
    });
    expect(classifyReactMessage('Warning: Expected server HTML to contain a matching <div> in <main>.')).toMatchObject({ kind: 'structure-warning' });
    expect(classifyReactMessage('Text content does not match server-rendered HTML.')).toMatchObject({ kind: 'text-mismatch' });
    expect(classifyReactMessage('Warning: Each child in a list should have a unique "key" prop.')).toBeUndefined();
  });
});

describe('component stacks', () => {
  it('parses V8, Firefox and host frames', () => {
    const stack = '\n    at p (<anonymous>)\n    at Layout (http://x.test/app.js:10:5)\n    at r (http://x.test/app.js:1:200)\n    at main\nApp@http://x.test/app.js:3:1';
    expect(parseComponentStack(stack)).toEqual([
      { name: 'p' },
      { name: 'Layout', url: 'http://x.test/app.js', line: 10, column: 5 },
      { name: 'r', url: 'http://x.test/app.js', line: 1, column: 200 },
      { name: 'main' },
      { name: 'App', url: 'http://x.test/app.js', line: 3, column: 1 },
    ]);
    expect(componentFrames(stack).map((frame) => frame.name)).toEqual(['Layout', 'r', 'App']);
    expect(parseComponentStack(undefined)).toEqual([]);
  });
});
