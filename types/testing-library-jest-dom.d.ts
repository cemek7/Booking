/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/jest-globals';

// Two entry points, because tests here use two different `expect`s:
//   - the subpath import above augments `expect` from '@jest/globals'
//   - the triple-slash reference augments the GLOBAL `expect` (@types/jest),
//     which is what component tests like BrandMark.test.tsx call
// With only the first, every global-`expect` assertion on the DOM
// (toHaveClass, toHaveAttribute, toBeInTheDocument) failed to typecheck while
// passing perfectly at runtime. The matchers themselves are registered at
// runtime by src/test/jest.setup.ts.
