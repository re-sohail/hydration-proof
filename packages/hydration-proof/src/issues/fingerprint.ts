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
      // React useId output: :R1: / :r1: (18), «r1» (19.1), _R_1_ (19.2+), escaped or not
      .replace(/(?:\\?:|«)[rR][0-9a-zA-Z]*(?:\\?:|»)|_[rR]_[0-9a-zA-Z]*_/g, 'r*')
      // Hashed CSS-in-JS / CSS module suffixes (letters and digits mixed)
      .replace(/[_-](?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{5,}(?=$|[\s>.#:[])/gi, '')
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
