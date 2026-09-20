import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
};

export default tseslint.config(
  {
    ignores: [
      "**/.trae/**",
      "**/coverage/**",
      "**/dist/**",
      "**/es/**",
      "**/lib/**",
      "**/site-dist/**",
      "**/.pnpm-store/**",
      "**/node_modules/**",
      "**/*.d.ts",
    ],
  },
  {
    extends: [eslint.configs.recommended],
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: sharedGlobals,
    },
  },
  {
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...eslintPluginVue.configs["flat/recommended"],
    ],
    files: ["**/*.vue"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: sharedGlobals,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: sharedGlobals,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    // 子进程一律以 argv 直传，不再启用 shell（docs/adr/0002-subprocess-argv-no-shell.md）。
    // 只作用于产品源码：scripts/** 是维护者本地脚本，天然在作用域外。
    files: ["packages/**/*.{ts,mts,cts,vue}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='shell']",
          message:
            "子进程一律以 argv 直传，禁用 shell 选项（见 docs/adr/0002-subprocess-argv-no-shell.md）",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              importNames: ["exec", "execSync"],
              message:
                "禁止用命令字符串启动子进程；请用 execa 直传 argv（见 docs/adr/0002-subprocess-argv-no-shell.md）",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
