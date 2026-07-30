#!/usr/bin/env node
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const appRoot = resolve(import.meta.dirname, "..");
const cssRoot = join(appRoot, "dist", "_expo", "static", "css");
const katexCss = require.resolve("katex/dist/katex.min.css");
const sourceFonts = join(dirname(katexCss), "fonts");

if (!existsSync(cssRoot)) {
  throw new Error(`Expo CSS output not found: ${cssRoot}`);
}

const katexStylesheets = readdirSync(cssRoot).filter(
  (entry) =>
    entry.endsWith(".css") &&
    readFileSync(join(cssRoot, entry), "utf8").includes("font-family:KaTeX"),
);
if (katexStylesheets.length === 0) {
  throw new Error(`Exported KaTeX stylesheet not found in: ${cssRoot}`);
}

const targetFonts = join(cssRoot, "fonts");
cpSync(sourceFonts, targetFonts, { recursive: true, force: true });
console.log(`Copied KaTeX fonts to ${targetFonts}`);
