let runtimeSource: Promise<string> | undefined;
function loadRuntime() {
  return (runtimeSource ??= fetch("/preview-runtime.js")
    .then(async (response) => {
      if (!response.ok) throw new Error("Preview runtime failed to load.");
      return response.text();
    })
    .catch((error) => {
      runtimeSource = undefined;
      throw error;
    }));
}
import type * as Babel from "@babel/standalone";
let compiler: Promise<typeof Babel> | undefined;
function loadBabel() {
  return (compiler ??= new Promise<typeof Babel>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/babel.min.js";
    script.onload = () =>
      resolve((window as unknown as { Babel: typeof Babel }).Babel);
    script.onerror = () => {
      compiler = undefined;
      reject(new Error("Could not load the preview compiler. Retry preview."));
    };
    document.head.append(script);
  }));
}
import type { FileNode } from "../../../../packages/shared/src/index";
export function resolvePath(from: string, target: string, paths: string[]) {
  if (!target.startsWith(".") && !target.startsWith("/"))
    throw new Error(
      `Package "${target}" is not available. Only React and project files are supported.`,
    );
  const parts = (
    target.startsWith("/")
      ? target
      : from.slice(0, from.lastIndexOf("/") + 1) + target
  ).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part && part !== ".") stack.push(part);
  }
  const path = stack.join("/");
  const found = [
    path,
    path + ".js",
    path + ".jsx",
    path + ".ts",
    path + ".tsx",
    path + "/index.js",
    path + "/index.tsx",
  ].find((p) => paths.includes(p));
  if (!found) throw new Error(`Cannot resolve ${target} from ${from}`);
  return found;
}
const scriptSafe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
export async function buildPreview(
  files: FileNode[],
  entry: string,
  channel: string,
) {
  const { transform } = await loadBabel();
  const paths = files.filter((f) => f.type === "file").map((f) => f.path);
  const html = files.find((f) => f.path === entry)?.content;
  if (!html) throw new Error(`Preview entry ${entry} is missing or empty.`);
  const page = new DOMParser().parseFromString(html, "text/html");
  page.querySelectorAll("base,meta[http-equiv]").forEach((n) => n.remove());
  const styles: Record<string, string> = {};
  const modules: Record<string, string> = {};
  const json: Record<string, unknown> = {};
  for (const f of files) {
    if (f.type !== "file") continue;
    if (f.path.endsWith(".css")) styles[f.path] = f.content;
    else if (f.path.endsWith(".json")) {
      try {
        json[f.path] = JSON.parse(f.content);
      } catch {
        throw new Error(`Invalid JSON in ${f.path}`);
      }
    } else if (/\.[jt]sx?$/.test(f.path)) {
      modules[f.path] =
        transform(f.content, {
          filename: f.path,
          presets: [
            [
              "typescript",
              { allExtensions: true, isTSX: f.path.endsWith("x") },
            ],
            ["react", { runtime: "classic" }],
          ],
          plugins: ["transform-modules-commonjs"],
          sourceMaps: false,
        }).code ?? "";
    }
  }
  function css(path: string, seen = new Set<string>()): string {
    if (seen.has(path)) throw new Error(`Circular CSS import in ${path}`);
    seen.add(path);
    return (styles[path] ?? "").replace(
      /@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g,
      (_m, target: string) =>
        css(resolvePath(path, target, paths), new Set(seen)),
    );
  }
  for (const link of page.querySelectorAll('link[rel="stylesheet"]')) {
    const target = link.getAttribute("href") ?? "";
    const path = resolvePath(
      entry,
      target.startsWith(".") || target.startsWith("/") ? target : "./" + target,
      paths,
    );
    const style = page.createElement("style");
    style.textContent = css(path);
    link.replaceWith(style);
  }
  const entries: string[] = [];
  for (const [i, script] of [...page.querySelectorAll("script")].entries()) {
    const target = script.getAttribute("src");
    if (target) {
      entries.push(
        resolvePath(
          entry,
          target.startsWith(".") || target.startsWith("/")
            ? target
            : "./" + target,
          paths,
        ),
      );
    } else {
      const key = `__inline_${i}.js`;
      modules[key] =
        transform(script.textContent ?? "", {
          plugins: ["transform-modules-commonjs"],
        }).code ?? "";
      entries.push(key);
    }
    script.remove();
  }
  const csp = page.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';`;
  page.head.prepend(csp);
  const bridge = page.createElement("script");
  bridge.textContent = `(()=>{const channel=${JSON.stringify(channel)};const send=(level,args)=>{let text;try{text=args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')}catch{text='[Unserializable value]'}parent.postMessage({channel,level,text:String(text).slice(0,4000)},'*')};for(const level of ['log','warn','error']){const old=console[level];console[level]=(...args)=>{send(level,args);old(...args)}}window.addEventListener('error',e=>send('error',[e.message]));window.addEventListener('unhandledrejection',e=>send('error',[String(e.reason)]));})();`;
  page.head.append(bridge);
  const runtime = page.createElement("script");
  runtime.textContent = scriptSafe(await loadRuntime());
  page.head.append(runtime);
  const runner = page.createElement("script");
  runner.textContent = `(()=>{const sources=${scriptSafe(JSON.stringify(modules))},styles=${scriptSafe(JSON.stringify(styles))},json=${scriptSafe(JSON.stringify(json))},paths=${JSON.stringify(paths)},cache={};const resolve=${resolvePath.toString()};function requireModule(path,from=''){if(path==='react')return window.__syncRuntime.React;if(path==='react-dom/client')return window.__syncRuntime.ReactDOM;const key=from?resolve(from,path,paths):path;if(cache[key])return cache[key].exports;if(key in styles){const style=document.createElement('style');style.textContent=styles[key];document.head.append(style);return {}}if(key in json)return json[key];if(!(key in sources))throw new Error('Module not found: '+key);const module={exports:{}};cache[key]=module;new Function('require','module','exports',sources[key]+'\\n//# sourceURL='+key)(p=>requireModule(p,key),module,module.exports);return module.exports}for(const entry of ${JSON.stringify(entries)})requireModule(entry)})();`;
  page.body.append(runner);
  return "<!doctype html>\n" + page.documentElement.outerHTML;
}
