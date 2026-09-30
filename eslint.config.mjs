import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "tsconfig.tsbuildinfo", "next-env.d.ts"]),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='$queryRaw']",
          message: "Use Prisma tagged-template queryRaw only after security review."
        }
      ]
    }
  },
  // Must stay last: turns off the stylistic rules Prettier owns.
  prettier
]);

export default eslintConfig;
