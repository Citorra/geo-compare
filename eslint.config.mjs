// Flat ESLint config. Next 16 removed `next lint`; lint runs via the ESLint CLI
// (`npm run lint`). `eslint-config-next/core-web-vitals` is a native flat-config
// array bundling the Next, TypeScript, and Core Web Vitals rule sets.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "out/**", "node_modules/**"],
  },
];

export default eslintConfig;
