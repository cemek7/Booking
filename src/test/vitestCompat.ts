/**
 * vitestCompat.ts — re-maps vitest imports to Jest globals.
 *
 * Some test files import { describe, it, expect, vi, ... } from 'vitest'.
 * This shim makes those tests runnable under Jest without modification.
 */

export const describe = globalThis.describe;
export const it = globalThis.it;
export const test = globalThis.test;
export const expect = globalThis.expect;
export const beforeAll = globalThis.beforeAll;
export const afterAll = globalThis.afterAll;
export const beforeEach = globalThis.beforeEach;
export const afterEach = globalThis.afterEach;

// vi ≈ jest
export const vi = {
  fn: jest.fn.bind(jest),
  spyOn: jest.spyOn.bind(jest),
  mock: jest.mock.bind(jest),
  clearAllMocks: jest.clearAllMocks.bind(jest),
  resetAllMocks: jest.resetAllMocks.bind(jest),
  restoreAllMocks: jest.restoreAllMocks.bind(jest),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mocked: <T>(fn: T): jest.MockedFunction<T extends (...args: never[]) => unknown ? T : never> =>
    fn as jest.MockedFunction<T extends (...args: never[]) => unknown ? T : never>,
};
