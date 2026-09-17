// Running hydration-proof from Node, for a script that does something else
// around it (start a server, seed a database, publish the report).
import { run } from 'hydration-proof';

const { exitCode, report } = await run({
  overrides: { url: 'http://localhost:3000', reporters: ['json'] },
  write: (text) => process.stdout.write(text),
});

// The report is the same object the JSON reporter writes.
for (const issue of report.issues) {
  if (issue.severity !== 'error') continue;
  console.log(`${issue.route.pattern} ${issue.code} ${issue.source?.file ?? '(no source)'} — ${issue.cause?.title ?? 'unknown cause'}`);
}

process.exit(exitCode);
