# Troubleshooting

## "chromium is not installed"

Run `npx hydration-proof install` (add `--with-deps` on Linux CI). It installs the browser for the Playwright version hydration-proof uses.

## "Nothing answers at …" / the app does not start

- Check `server.command` works on its own. `{port}` is replaced with the port hydration-proof chose; the port is also in the `PORT` environment variable.
- Increase `server.timeout` for slow builds.
- With `--url`, start the app first.

## Next.js development mode

`hydration-proof` opens the dev server on `localhost`, because Next.js blocks development resources for other hosts. If you test a dev server through another host name, add it to `allowedDevOrigins` in `next.config`.

## A difference that is intentional

Mark the element with `data-hydration-proof-ignore`, add a selector to `ignore.selectors`, or add an `ignore.issues` rule with a reason. For values that differ on purpose (timestamps), render them after mount or use `suppressHydrationWarning` on that element; `hydration-proof` then lists them as info.

## A page keeps changing and never settles

Pages with animations, polling or live data may never be quiet. Set `ready.selector` or `ready.function`, or lower `ready.quietMs`.

## Component names are single letters

Production builds minify component names. Run with `--mode development` to see real component names.

## TypeScript config errors

The config is loaded by Node.js directly. Use plain types (no `enum`), include file extensions in relative imports, or rename the file to `.mjs`.
