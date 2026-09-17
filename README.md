# hydration-proof

Find, explain and prevent React hydration problems before users see them.

This repository contains:

| Path | |
| --- | --- |
| [`packages/hydration-proof`](packages/hydration-proof) | The CLI and Node API published to npm as [`hydration-proof`](https://www.npmjs.com/package/hydration-proof) |
| [`packages/eslint-plugin-hydration-proof`](packages/eslint-plugin-hydration-proof) | ESLint rules published as [`eslint-plugin-hydration-proof`](https://www.npmjs.com/package/eslint-plugin-hydration-proof) |
| [`docs`](docs) | Documentation (also published at https://hydration.jscrate.dev) |
| [`examples`](examples) | Copy-paste configs and workflows for the setups that come up most |
| [`fixtures`](fixtures) | Apps with known hydration bugs, used to prove every detection |
| [`scripts`](scripts) | Fixture, measurement and documentation tooling |

Start with the [package README](packages/hydration-proof/README.md).

## Development

Requires Node.js 22.18+ and pnpm 10.

```bash
pnpm install
pnpm --filter hydration-proof exec playwright-core install chromium firefox webkit
pnpm test                 # unit and browser tests
pnpm fixtures:build       # build the Next.js fixture apps
pnpm test:e2e             # every fixture case against production builds
pnpm verify:fixtures      # React itself confirms each broken fixture (dev mode)
pnpm record:captures      # re-record the regression corpus in fixtures/captures
pnpm smoke pnpm           # pack and install into a fresh app (npm|pnpm|yarn|yarn-pnp|bun)
pnpm build                # build, publint, are-the-types-wrong, size budget (both packages)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Sohail Khan](https://me.jscrate.dev)
