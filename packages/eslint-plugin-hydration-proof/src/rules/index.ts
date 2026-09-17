import type { Rule } from 'eslint';
import { auditSuppressHydrationWarning } from './audit-suppress-hydration-warning.ts';
import { noBrowserGlobalInRender } from './no-browser-global-in-render.ts';
import { noClientOnlyInitialState } from './no-client-only-initial-state.ts';
import { noDateInRender } from './no-date-in-render.ts';
import { noGlobalRenderCounter } from './no-global-render-counter.ts';
import { noInvalidInteractiveNesting } from './no-invalid-interactive-nesting.ts';
import { noLocaleWithoutExplicitLocale } from './no-locale-without-explicit-locale.ts';
import { noMatchMediaInRender } from './no-match-media-in-render.ts';
import { noRandomInRender } from './no-random-in-render.ts';
import { noStorageInInitialRender } from './no-storage-in-initial-render.ts';
import { noTimezoneWithoutExplicitTimezone } from './no-timezone-without-explicit-timezone.ts';
import { noUnstableId } from './no-unstable-id.ts';
import { noWindowRenderBranch } from './no-window-render-branch.ts';
import { requireDeterministicListOrder } from './require-deterministic-list-order.ts';
import { requireStableServerSnapshot } from './require-stable-server-snapshot.ts';

export type RuleName =
  | 'no-date-in-render'
  | 'no-random-in-render'
  | 'no-browser-global-in-render'
  | 'no-storage-in-initial-render'
  | 'no-match-media-in-render'
  | 'no-locale-without-explicit-locale'
  | 'no-timezone-without-explicit-timezone'
  | 'no-unstable-id'
  | 'no-global-render-counter'
  | 'no-window-render-branch'
  | 'no-invalid-interactive-nesting'
  | 'audit-suppress-hydration-warning'
  | 'no-client-only-initial-state'
  | 'require-stable-server-snapshot'
  | 'require-deterministic-list-order';

export const rules: Record<RuleName, Rule.RuleModule> = {
  'no-date-in-render': noDateInRender,
  'no-random-in-render': noRandomInRender,
  'no-browser-global-in-render': noBrowserGlobalInRender,
  'no-storage-in-initial-render': noStorageInInitialRender,
  'no-match-media-in-render': noMatchMediaInRender,
  'no-locale-without-explicit-locale': noLocaleWithoutExplicitLocale,
  'no-timezone-without-explicit-timezone': noTimezoneWithoutExplicitTimezone,
  'no-unstable-id': noUnstableId,
  'no-global-render-counter': noGlobalRenderCounter,
  'no-window-render-branch': noWindowRenderBranch,
  'no-invalid-interactive-nesting': noInvalidInteractiveNesting,
  'audit-suppress-hydration-warning': auditSuppressHydrationWarning,
  'no-client-only-initial-state': noClientOnlyInitialState,
  'require-stable-server-snapshot': requireStableServerSnapshot,
  'require-deterministic-list-order': requireDeterministicListOrder,
};
