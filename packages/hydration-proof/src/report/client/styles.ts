// Styles of the HTML report. Kept as a string so the whole report is one file.
export const css = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f7f7f8;
  --panel: #ffffff;
  --panel-2: #f1f2f4;
  --text: #1b1d22;
  --muted: #5f6570;
  --border: #dfe1e6;
  --accent: #2d6cdf;
  --error: #c62a2a;
  --error-bg: #fdecec;
  --warning: #9a6200;
  --warning-bg: #fff4dc;
  --info: #25709a;
  --info-bg: #e6f3fa;
  --ok: #1d7a46;
  --ok-bg: #e5f5ec;
  --ins: #d6f5df;
  --del: #fbdcdc;
  --code-bg: #f4f5f7;
  --shadow: 0 1px 2px rgb(0 0 0 / 6%);
  --radius: 8px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317;
    --panel: #1a1d22;
    --panel-2: #22262d;
    --text: #e7e9ee;
    --muted: #9aa1ad;
    --border: #2e333b;
    --accent: #6c9cff;
    --error: #ff7a7a;
    --error-bg: #3a1c1f;
    --warning: #f2b54a;
    --warning-bg: #3a2d14;
    --info: #6cc3f0;
    --info-bg: #15303d;
    --ok: #5fd08f;
    --ok-bg: #16301f;
    --ins: #1d4d2c;
    --del: #5a2226;
    --code-bg: #15181c;
    --shadow: none;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 var(--sans); }
a { color: var(--accent); }
button { font: inherit; color: inherit; }
code, pre, .mono { font-family: var(--mono); font-size: 12.5px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.header { padding: 20px 24px 12px; border-bottom: 1px solid var(--border); background: var(--panel); }
.header h1 { margin: 0 0 4px; font-size: 20px; }
.meta { color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
.tiles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.tile { background: var(--panel-2); border-radius: var(--radius); padding: 8px 14px; min-width: 96px; }
.tile b { display: block; font-size: 20px; line-height: 1.2; }
.tile span { color: var(--muted); font-size: 12px; }
.tile.error b { color: var(--error); }
.tile.warning b { color: var(--warning); }
.tile.ok b { color: var(--ok); }

.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 24px; border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 2; }
.toolbar input[type=search], .toolbar select { background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; color: var(--text); font: inherit; }
.toolbar input[type=search] { min-width: 220px; flex: 1 1 220px; }
.chip { border: 1px solid var(--border); background: var(--panel-2); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.chip[aria-pressed=true] { background: var(--accent); border-color: var(--accent); color: #fff; }
.toolbar label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); }
.group { display: inline-flex; gap: 4px; align-items: center; }
.group-label { color: var(--muted); font-size: 12px; margin-right: 2px; }

.layout { display: grid; grid-template-columns: minmax(240px, 340px) 1fr; min-height: calc(100vh - 170px); }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .pages { max-height: 40vh; } }
.pages { border-right: 1px solid var(--border); overflow: auto; background: var(--panel); }
.page-item { display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: center; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: 10px 14px; cursor: pointer; }
.page-item:hover { background: var(--panel-2); }
.page-item[aria-current=true] { background: var(--panel-2); box-shadow: inset 3px 0 var(--accent); }
.page-item .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-item .scenario { color: var(--muted); font-size: 12px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot.passed { background: var(--ok); }
.dot.warning { background: var(--warning); }
.dot.failed, .dot.error { background: var(--error); }
.count { font-size: 12px; border-radius: 999px; padding: 1px 8px; background: var(--error-bg); color: var(--error); }
.count.warning { background: var(--warning-bg); color: var(--warning); }

.detail { padding: 18px 24px 48px; overflow: auto; }
.empty { color: var(--muted); padding: 40px 0; text-align: center; }
.page-head h2 { margin: 0; font-size: 18px; word-break: break-all; }
.page-head .meta { margin-top: 4px; }
.section-title { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 22px 0 8px; }

.issue { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); margin: 12px 0; overflow: hidden; }
.issue.error { border-left: 4px solid var(--error); }
.issue.warning { border-left: 4px solid var(--warning); }
.issue.info { border-left: 4px solid var(--info); }
.issue.ignored { opacity: .7; }
.issue > summary { list-style: none; cursor: pointer; padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.issue > summary::-webkit-details-marker { display: none; }
.issue-body { padding: 0 16px 16px; }
.badge { font: 600 12px var(--mono); border-radius: 4px; padding: 1px 6px; }
.badge.error { background: var(--error-bg); color: var(--error); }
.badge.warning { background: var(--warning-bg); color: var(--warning); }
.badge.info { background: var(--info-bg); color: var(--info); }
.issue-title { font-weight: 600; }
.cause { font-size: 12px; background: var(--panel-2); border-radius: 999px; padding: 2px 10px; }
.cause.proven { background: var(--ok-bg); color: var(--ok); }
.cause.flaky { background: var(--warning-bg); color: var(--warning); }
.cause.new { background: var(--error-bg); color: var(--error); }
.trend { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.trend-chart { background: var(--panel-2); border-radius: var(--radius); }
.trend-chart path { stroke-width: 2; }
.trend-chart .trend-error { stroke: var(--error); fill: var(--error); }
.trend-chart .trend-warning { stroke: var(--warning); fill: var(--warning); }
.trend-chart path.trend-error, .trend-chart path.trend-warning { fill: none; }
.legend::before { content: ''; display: inline-block; width: 10px; height: 3px; margin-right: 4px; vertical-align: middle; }
.legend.error::before { background: var(--error); }
.legend.warning::before { background: var(--warning); }
table.probes { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 13px; }
table.probes th, table.probes td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.probes th { color: var(--muted); font-weight: 600; font-size: 12px; }
table.probes tr.changes td:nth-child(2) { color: var(--ok); font-weight: 600; }
table.probes tr.current { background: var(--panel-2); }
button.link { border: 0; background: none; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; }
.where { color: var(--muted); font-size: 13px; width: 100%; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 10px 0; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; min-width: 0; word-break: break-word; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
@media (max-width: 700px) { .compare { grid-template-columns: 1fr; } }
.compare > div { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; min-width: 0; }
.compare h4 { margin: 0; padding: 6px 10px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); }
.compare pre { padding: 8px 10px; max-height: 320px; overflow: auto; }
ins { background: var(--ins); text-decoration: none; }
del { background: var(--del); text-decoration: none; }
.frame { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; overflow: auto; margin: 8px 0; }
ul.plain { margin: 6px 0; padding-left: 18px; }
ul.plain li { margin: 3px 0; }
.small { font-size: 12px; color: var(--muted); }
.copy { border: 1px solid var(--border); background: var(--panel-2); border-radius: 4px; padding: 0 6px; font-size: 12px; cursor: pointer; }

.shots { display: flex; gap: 8px; margin-bottom: 8px; }
.shot { position: relative; border: 1px solid var(--border); border-radius: 6px; overflow: auto; max-height: 420px; background: var(--panel-2); }
.shot img { display: block; max-width: 100%; }
.box { position: absolute; border: 2px solid var(--error); background: rgb(198 42 42 / 12%); border-radius: 2px; pointer-events: none; }
.box.active { border-color: var(--accent); background: rgb(45 108 223 / 18%); }

.timeline { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--border); }
.timeline li { position: relative; padding: 3px 0 3px 16px; }
.timeline li::before { content: ''; position: absolute; left: -6px; top: 10px; width: 10px; height: 10px; border-radius: 50%; background: var(--border); }
.timeline li.error::before { background: var(--error); }
.timeline li.commit::before { background: var(--accent); }
.timeline li.mutation::before { background: var(--warning); }
.timeline time { color: var(--muted); font-family: var(--mono); font-size: 12px; margin-right: 8px; }
footer { color: var(--muted); font-size: 12px; padding: 16px 24px; border-top: 1px solid var(--border); }
`;
