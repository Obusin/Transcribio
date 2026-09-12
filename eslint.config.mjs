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
    // Benchmark venv + datasets (Python deps ship their own JS).
    "bench/.venv/**",
    "bench/data/**",
    // Vendored pdf.js worker and font/cmap assets, served as-is from public/.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
