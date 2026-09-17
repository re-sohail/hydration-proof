import type { Browser, Page } from 'playwright-core';
import type { InteractionConfig } from '../config/types.ts';
import type { Draft } from '../analyze/draft.ts';
import type { InputState, InteractionTargets, PageObservation } from '../shared/protocol.ts';
import { capturePage, waitForQuiet, type PageCapture, type ReadyOptions } from './capture.ts';
import { createScenarioContext, type ScenarioSpec } from './context.ts';
import { callRuntime } from './runtime-loader.ts';

// Interactions before and after hydration: text typed, boxes checked, focus,
// selection and scroll made while the page is still loading must survive
// hydration, and a click made while loading should not be silently lost.

const TYPED = 'hydration-proof check';
const SCROLL_TOLERANCE = 50;
const PARSE_TIMEOUT = 10_000;
const ACTION_TIMEOUT = 3_000;

export interface ScriptHold {
  release(): void;
}

/** Delay every script response of the page until `release()`. Inline scripts still run. */
export async function holdScripts(page: Page): Promise<ScriptHold> {
  const waiting: (() => void)[] = [];
  let released = false;
  await page.route('**/*', async (route) => {
    if (!released && route.request().resourceType() === 'script') {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    await route.fallback().catch(() => {});
  });
  return {
    release() {
      released = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

/** Wait until the server HTML is parsed (scripts may still be pending). */
async function waitParsed(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction('document.readyState !== "loading" && document.body !== null', undefined, { timeout: PARSE_TIMEOUT, polling: 25 });
    return true;
  } catch {
    return false;
  }
}

const findTargets = (page: Page): Promise<InteractionTargets> => callRuntime<InteractionTargets>(page, 'interactionTargets');
const readState = (page: Page, targets: InteractionTargets): Promise<InputState> => callRuntime<InputState>(page, 'inputState', targets);
const observe = (page: Page): Promise<PageObservation> => callRuntime<PageObservation>(page, 'observe');

const hydrated = (capture: PageCapture): boolean => capture.outcome === 'hydrated' || capture.outcome === 'hydration-stalled';

export interface InteractionCheckOptions {
  ready: ReadyOptions;
  scenario: ScenarioSpec;
}

export interface InteractionOutcome {
  drafts: Draft[];
  /** Why the check could not run. */
  skipped?: string;
  /** The page has nothing this check can try (not a problem). */
  idle?: boolean;
}

function note(message: string): Draft['evidence'][number] {
  return { kind: 'note', message };
}

/**
 * Type, check a box, move focus and scroll while scripts are held back, then
 * let the page hydrate and verify that nothing was lost.
 */
export async function checkEarlyInput(browser: Browser, url: string, options: InteractionCheckOptions): Promise<InteractionOutcome> {
  const context = await createScenarioContext(browser, options.scenario);
  let targets: InteractionTargets | undefined;
  let before: InputState | undefined;
  let after: InputState | undefined;
  let skipped: string | undefined;
  try {
    let hold: ScriptHold | undefined;
    const capture = await capturePage(context, url, options.ready, {
      prepare: async (page) => {
        hold = await holdScripts(page);
      },
      beforeHydration: async (page) => {
        try {
          if (!(await waitParsed(page))) {
            skipped = 'the page did not finish parsing while its scripts were held back';
            return;
          }
          targets = await findTargets(page);
          if (!targets.input && !targets.checkbox && !targets.scrollable) {
            skipped = 'idle';
            return;
          }
          if (targets.input) await page.fill(targets.input, TYPED, { timeout: ACTION_TIMEOUT });
          if (targets.checkbox) await page.check(targets.checkbox, { timeout: ACTION_TIMEOUT }).catch(() => undefined);
          await callRuntime(page, 'prepareInput', targets);
          before = await readState(page, targets);
        } catch (error) {
          skipped = `the controls could not be used before hydration (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`;
        } finally {
          hold?.release();
        }
      },
      beforeClose: async (page, result) => {
        if (!targets || !before || skipped) return;
        if (!hydrated(result)) {
          skipped = `the page did not hydrate (${result.outcome})`;
          return;
        }
        after = await readState(page, targets);
      },
    });
    if (capture.outcome === 'navigation-failed') skipped = 'the page did not load';
  } finally {
    await context.close();
  }
  if (skipped === 'idle') return { drafts: [], idle: true };
  if (skipped !== undefined) return { drafts: [], skipped };
  if (!targets || !before || !after) return { drafts: [], skipped: 'the check did not complete' };

  const drafts: Draft[] = [];
  const replacedNote = after.fieldReplaced ? [note('React replaced the field during hydration, so the new field lost what was typed.')] : [];
  if (targets.input && before.value === TYPED && after.value !== TYPED) {
    drafts.push({
      code: 'HP5002',
      stage: 'post-effect',
      confidence: 0.9,
      selector: targets.input,
      attribute: 'value',
      server: TYPED,
      client: after.value ?? null,
      message: `Text typed into this field before the page finished hydrating was ${after.value ? `replaced with ${JSON.stringify(after.value)}` : 'cleared'}.`,
      evidence: [note(`Typed ${JSON.stringify(TYPED)} while the page's scripts were still loading.`), ...replacedNote],
    });
  }
  if (targets.checkbox && before.checked === true && after.checked !== true) {
    drafts.push({
      code: 'HP5002',
      stage: 'post-effect',
      confidence: 0.9,
      selector: targets.checkbox,
      attribute: 'checked',
      server: 'checked',
      client: 'unchecked',
      message: 'A checkbox checked before the page finished hydrating was unchecked by hydration.',
      evidence: [note("Checked the box while the page's scripts were still loading.")],
    });
  }
  if (targets.input && before.focused && !after.focused) {
    drafts.push({
      code: 'HP5003',
      stage: 'post-effect',
      confidence: 0.85,
      selector: targets.input,
      message: 'The text field that had focus before hydration lost it while the page hydrated.',
      evidence: [note("Focused the field while the page's scripts were still loading."), ...replacedNote],
    });
  } else if (
    targets.input &&
    before.focused &&
    before.selection &&
    after.selection &&
    (before.selection[0] !== after.selection[0] || before.selection[1] !== after.selection[1])
  ) {
    drafts.push({
      code: 'HP5003',
      stage: 'post-effect',
      confidence: 0.7,
      selector: targets.input,
      attribute: 'selection',
      server: before.selection.join('-'),
      client: after.selection.join('-'),
      message: `The text selection in the field changed from ${before.selection.join('-')} to ${after.selection.join('-')} while the page hydrated.`,
      evidence: [note("Selected text in the field while the page's scripts were still loading.")],
    });
  }
  if (targets.scrollable && before.scrollY > 0 && Math.abs(after.scrollY - before.scrollY) > SCROLL_TOLERANCE) {
    drafts.push({
      code: 'HP5007',
      stage: 'post-effect',
      confidence: 0.8,
      key: 'scroll',
      server: String(before.scrollY),
      client: String(after.scrollY),
      message: `The page was scrolled to ${before.scrollY}px before hydration and ended at ${after.scrollY}px.`,
      evidence: [note("Scrolled while the page's scripts were still loading.")],
    });
  }
  return { drafts };
}

type ClickMode = 'none' | 'early' | 'late';

async function clickRun(browser: Browser, url: string, button: string, mode: ClickMode, options: InteractionCheckOptions): Promise<PageObservation | undefined> {
  const context = await createScenarioContext(browser, options.scenario);
  let observation: PageObservation | undefined;
  try {
    let hold: ScriptHold | undefined;
    let clicked = mode !== 'early';
    await capturePage(context, url, options.ready, {
      ...(mode === 'early'
        ? {
            prepare: async (page: Page) => {
              hold = await holdScripts(page);
            },
            beforeHydration: async (page: Page) => {
              try {
                if (await waitParsed(page)) {
                  await page.click(button, { timeout: ACTION_TIMEOUT });
                  clicked = true;
                }
              } catch {
                clicked = false;
              } finally {
                hold?.release();
              }
            },
          }
        : {}),
      beforeClose: async (page, result) => {
        if (!clicked || !hydrated(result)) return;
        if (mode === 'late') {
          try {
            await page.click(button, { timeout: ACTION_TIMEOUT });
          } catch {
            return;
          }
          await waitForQuiet(page, options.ready.quietMs, options.ready.pollMs, Date.now() + 5_000);
        }
        observation = await observe(page);
      },
    });
  } finally {
    await context.close();
  }
  return observation;
}

/** A click on the first button while the page loads, compared with a click after hydration. */
export async function checkEarlyClick(browser: Browser, url: string, options: InteractionCheckOptions): Promise<InteractionOutcome> {
  const probeContext = await createScenarioContext(browser, options.scenario);
  let button: string | undefined;
  try {
    const page = await probeContext.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.ready.timeout }).catch(() => null);
    if (response) button = (await findTargets(page).catch(() => undefined))?.button;
  } finally {
    await probeContext.close();
  }
  if (!button) return { drafts: [], idle: true };

  const [none, again, late, early] = await Promise.all([
    clickRun(browser, url, button, 'none', options),
    clickRun(browser, url, button, 'none', options),
    clickRun(browser, url, button, 'late', options),
    clickRun(browser, url, button, 'early', options),
  ]);
  if (!none || !again || !late || !early) return { drafts: [], skipped: 'not every load of the page hydrated' };
  const same = (a: PageObservation, b: PageObservation): boolean => a.text === b.text && a.url === b.url;
  if (!same(none, again)) return { drafts: [], skipped: 'the page renders differently on every load' };
  if (same(late, none)) return { drafts: [], idle: true };
  if (!same(early, none)) return { drafts: [] };
  return {
    drafts: [
      {
        code: 'HP5001',
        stage: 'post-effect',
        confidence: 0.8,
        selector: button,
        message: 'A click on this button while the page was loading did nothing; the same click after hydration changes the page.',
        evidence: [note("The page's scripts were held back while the button was clicked, then released.")],
      },
    ],
  };
}

/** Run a configured interaction on a page, before or after hydration. */
export async function runCustomInteraction(
  browser: Browser,
  url: string,
  baseUrl: string,
  interaction: InteractionConfig,
  options: InteractionCheckOptions,
): Promise<InteractionOutcome> {
  const context = await createScenarioContext(browser, options.scenario);
  const name = interaction.name ?? `interaction on ${interaction.route}`;
  const early = interaction.when === 'before-hydration';
  let failure: string | undefined;
  let stepsStarted = 0;
  let pageErrors: string[] = [];
  const steps = async (page: Page): Promise<void> => {
    stepsStarted = Date.now();
    try {
      await interaction.steps({ page, baseUrl, url });
    } catch (error) {
      failure = error instanceof Error ? error.message.split('\n')[0]! : String(error);
    }
  };
  try {
    let hold: ScriptHold | undefined;
    await capturePage(context, url, options.ready, {
      ...(early
        ? {
            prepare: async (page: Page) => {
              hold = await holdScripts(page);
            },
            beforeHydration: async (page: Page) => {
              try {
                if (await waitParsed(page)) await steps(page);
                else failure = 'The page did not finish parsing while its scripts were held back.';
              } finally {
                hold?.release();
              }
            },
          }
        : {}),
      beforeClose: async (page, result) => {
        if (!early) {
          if (!hydrated(result)) {
            failure = `The page did not hydrate (${result.outcome}).`;
            return;
          }
          await steps(page);
          await waitForQuiet(page, options.ready.quietMs, options.ready.pollMs, Date.now() + 10_000);
        } else if (!hydrated(result) && failure === undefined) {
          failure = `The page did not hydrate after the interaction (${result.outcome}).`;
        }
        pageErrors = result.pageErrors.filter((error) => stepsStarted > 0 && error.at >= stepsStarted).map((error) => error.message);
      },
    });
  } finally {
    await context.close();
  }
  if (failure === undefined && pageErrors.length === 0) return { drafts: [] };
  return {
    drafts: [
      {
        code: 'HP5008',
        stage: 'runtime',
        confidence: 0.95,
        key: name,
        message:
          failure !== undefined
            ? `"${name}" failed: ${failure}`
            : `"${name}" caused ${pageErrors.length === 1 ? 'an error' : `${pageErrors.length} errors`} on the page: ${pageErrors[0]}`,
        evidence: pageErrors.map((message) => ({ kind: 'page-error' as const, message })),
      },
    ],
  };
}
