import type { Browser, BrowserContext } from 'playwright-core';
import type { LoginContext } from '../config/types.ts';
import { createScenarioContext, type ScenarioSpec } from './context.ts';

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export class LoginError extends Error {
  override name = 'LoginError';
}

/**
 * Run a scenario's login once and return the cookies and storage it left.
 * The login page gets the same context options (and mocks) as the tests.
 */
export async function performLogin(
  browser: Browser,
  scenario: ScenarioSpec,
  login: (context: LoginContext) => Promise<void>,
  baseUrl: string,
): Promise<StorageState> {
  const context = await createScenarioContext(browser, { ...scenario, initScripts: [] });
  try {
    const page = await context.newPage();
    try {
      await login({ page, baseUrl });
    } catch (error) {
      throw new LoginError(`The login of scenario "${scenario.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return await context.storageState();
  } finally {
    await context.close();
  }
}
