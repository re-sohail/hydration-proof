// Data the development overlay shows, and the names it is reached by.

export const OVERLAY_GLOBAL = '__hydrationProofOverlay';
export const OVERLAY_BINDING = '__hydrationProofAction';
export const OVERLAY_TAG = 'hydration-proof-overlay';

export interface OverlayIssue {
  fingerprint: string;
  code: string;
  title: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  selector?: string;
  attribute?: string;
  server?: string | null;
  client?: string | null;
  component?: string;
  cause?: { title: string; confidence: number; proven?: boolean };
  source?: { file: string; line: number; column?: number; absolute?: string };
  suggestions: string[];
  docsUrl: string;
}

export interface OverlayState {
  status: 'analyzing' | 'done' | 'failed';
  url: string;
  issues: OverlayIssue[];
  /** How hydration went (hydrated, client-only, no-react, ...). */
  outcome?: string;
  react?: string;
  durationMs?: number;
  error?: string;
}

export type OverlayAction =
  | { type: 'open'; file: string; line: number; column?: number }
  | { type: 'rerun' }
  | { type: 'copied'; count: number };
