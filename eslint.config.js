import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".agents/**",
      "skills/**",
      "reference/**",
      "public/game/audio/**",
      "public/game/tilemap/**",
      "tools/**/*.py",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts", "tools/**/*.mjs", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
