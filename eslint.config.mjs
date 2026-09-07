import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build outputs. tsconfig already excludes dist/; linting it only produced
    // errors nobody can act on, and `eslint --fix` rewrote a generated file.
    "dist/**",
    ".tsbuild/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
