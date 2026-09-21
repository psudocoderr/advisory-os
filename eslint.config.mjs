import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "tsconfig.tsbuildinfo"]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
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
  ...compat.extends("prettier")
];

export default eslintConfig;
