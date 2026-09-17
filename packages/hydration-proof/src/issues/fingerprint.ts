import { createHash } from 'node:crypto';
import type { IssueCode } from './registry.ts';

// Fingerprints identify "the same problem" across runs, machines and
// scenarios. Bump FINGERPRINT_VERSION only together with a baseline migration.

export const FINGERPRINT_VERSION = 1;

export interface FingerprintInput {
  code: IssueCode;
  routePattern: string;
  selector?: string;
  attribute?: string;
  /** Extra discriminator for issues without a selector. */
  key?: string;
}

const SEPARATOR = '\n';

/** Remove parts of a selector that change between builds. */
export function stableSelector(selector: string): string {
  return (
    selector
      // React useId output: :r1:, «r1», _r_1_ (escaped or not)
      .replace(/(?:\\?:|«|_)r[0-9a-z]+(?:\\?:|»|_)/gi, 'r*')
      // Hashed CSS-in-JS / CSS module suffixes
      .replace(/[_-][a-z0-9]{5,}(?=$|[\s>.#:[])/gi, '')
  );
}

export function fingerprint(input: FingerprintInput): string {
  const parts = [
    `v${FINGERPRINT_VERSION}`,
    input.code,
    input.routePattern,
    input.selector === undefined ? '' : stableSelector(input.selector),
    input.attribute ?? '',
    input.key ?? '',
  ];
  return createHash('sha256').update(parts.join(SEPARATOR)).digest('hex').slice(0, 16);
}
