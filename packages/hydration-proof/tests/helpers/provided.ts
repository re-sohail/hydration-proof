export type ReactVersion = '18' | '19';
export type BuildMode = 'development' | 'production';

export type HarnessUrls = Record<`${ReactVersion}-${BuildMode}`, string>;

declare module 'vitest' {
  export interface ProvidedContext {
    harness: HarnessUrls;
  }
}
