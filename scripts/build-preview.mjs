import { build } from "esbuild";
await build({
  stdin: {
    contents:
      "import React from 'react'; import * as ReactDOM from 'react-dom/client'; globalThis.__syncRuntime={React,ReactDOM};",
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  outfile: "apps/web/public/preview-runtime.js",
  define: { "process.env.NODE_ENV": '"production"' },
});

import { copyFileSync } from "node:fs";
copyFileSync(
  "node_modules/@babel/standalone/babel.min.js",
  "apps/web/public/babel.min.js",
);
