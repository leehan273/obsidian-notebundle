/// <reference types="node" />

import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
    globalIgnores([
        "node_modules",
        "dist",
        "esbuild.config.mjs",
        "version-bump.mjs",
        "versions.json",
        "main.js",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
    ]),
    {
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["eslint.config.mts"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    ...obsidianmd.configs.recommended,
    {
        rules: {
            "obsidianmd/commands/no-plugin-name-in-command-name": "off", // can't describe `.notebundle` without type notebundle...
        },
    },
    {
        files: [
            "src/ui/NotebundleConversionModal.ts",
            "src/ui/NotebundleInspectModal.ts",
            "src/ui/RenameBundleModal.ts",
        ],
        rules: {
            "obsidianmd/no-static-styles-assignment": "off", // WIP Components
        },
    },
);
