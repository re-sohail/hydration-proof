# Golden files for the CI reporter tests

`junit.xml`, `report.sarif`, `gl-code-quality.json`, `github-annotations.txt` and `github-summary.md` are the expected outputs of the reporters for the report in `../fixture.ts`. After an intended change, regenerate them with:

```sh
UPDATE_GOLDEN=1 pnpm --filter hydration-proof exec vitest run --project unit tests/unit/reporters
```

`sarif-2.1.0.schema.json` is the official SARIF 2.1.0 JSON schema (Errata 01, OASIS Standard), downloaded unmodified on 2026-09-17 from <https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json> (sha256 `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e`). It is an OASIS work product, © OASIS Open, used here only as a test fixture under the OASIS IPR Policy (<https://www.oasis-open.org/policies-guidelines/ipr/>). It is not published with the package. The copy on json.schemastore.org was not used: its draft-07 conversion moved properties such as `message.text` into `anyOf` next to `additionalProperties: false`, so it rejects every valid log. The OASIS file is draft-04. The only draft-04 keyword it uses is the root `id`, so the test renames that to `$id` and validates with Ajv's draft-07 validator.
