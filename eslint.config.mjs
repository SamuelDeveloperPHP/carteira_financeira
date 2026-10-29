import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Regras recomendadas, sem enfeites. O objetivo é pegar erro de verdade
// (variável não usada, any acidental, promessa esquecida), não discutir estilo:
// o estilo é do Prettier.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "frontend/public/vendor/**",
      "e2e/playwright-report/**",
      "e2e/test-results/**",
      "**/*.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["frontend/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    rules: {
      // `any` existe em poucos pontos de borda (corpo JSON da API, linhas do pg).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
