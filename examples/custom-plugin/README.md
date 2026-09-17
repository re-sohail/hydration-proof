# Teaching the tool about your own code

Two kinds of knowledge the tool cannot have:

1. **Markup that is meant to differ.** A support-chat widget, an analytics
   attribute, a CDN that rewrites HTML. Left alone, these are reported on every
   page, which is worse than useless — it trains people to ignore the report.
2. **Why a finding happened.** The tool can prove *time* and *random* with
   probes, but it cannot know that `data-region` comes from a geo header.

A plugin supplies both, plus route providers and reporters. It is a plain object,
so it can live next to the config or be published as a package your apps share.

## Normalizers, not ignores

`ignore.selectors` drops a subtree from the comparison. A normalizer is finer and
composes: it decides per node, and can return `'opaque'` instead of `'drop'`,
which keeps the element in the tree (so its position is still compared) while
never comparing its contents. That is the right answer for framework script tags
and for anything whose *presence* matters but whose body does not.

## Detectors

A detector runs on a finding and may return a cause. The most confident cause
wins, except that a cause **proven** by a differential probe is always kept — a
plugin cannot overrule evidence. A detector that throws is recorded as evidence
on the finding, not as a failed run, so a broken plugin degrades the report
instead of breaking the pipeline.

Keep `confidence` honest: below about 0.5 for a guess, 0.8+ only when the
evidence is specific. The number decides which explanation the reader sees first.

## Route providers

Routes that only a running system knows: pages from a CMS, tenants from a
database, a list behind an internal endpoint. The provider runs with the app
already started, so it can just ask it. A provider that fails adds a note and the
run continues with the routes it does have.

## Reporters

`onEnd` gets the finished report. Post to Slack, write a custom format, push a
metric. Return the files you wrote and they are listed with the built-in ones.
