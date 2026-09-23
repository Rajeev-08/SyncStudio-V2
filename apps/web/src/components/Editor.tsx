import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/language/css/monaco.contribution.js";
import "monaco-editor/esm/vs/language/html/monaco.contribution.js";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution.js";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution.js";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { MonacoBinding } from "y-monaco";
import { loader } from "@monaco-editor/react";
import type { DocumentState } from "../lib/collaboration";
import { language } from "../../../../packages/shared/src/index";
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less")
      return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor")
      return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });
monaco.editor.defineTheme("sync-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#17181f",
    "editorLineNumber.foreground": "#56596a",
    "editor.lineHighlightBackground": "#1e202a",
    "editor.selectionBackground": "#51488966",
    "editorCursor.foreground": "#b1a5ff",
  },
});
const viewStates = new WeakMap<
  DocumentState,
  monaco.editor.ICodeEditorViewState
>();
export interface EditorSettings {
  fontSize: number;
  minimap: boolean;
  wrap: boolean;
  theme: "dark" | "light";
}
export function CodeEditor({
  path,
  document,
  readOnly,
  settings,
  onSelection,
  onReady,
}: {
  path: string;
  document: DocumentState;
  readOnly: boolean;
  settings: EditorSettings;
  onSelection: (selection: {
    text: string;
    line: number;
    endLine: number;
  }) => void;
  onReady: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    callback = useRef(onSelection);
  callback.current = onSelection;
  useEffect(() => {
    const uri = monaco.Uri.parse(
      `inmemory://sync/${document.doc.guid}/${path}`,
    );
    const existing = monaco.editor.getModel(uri);
    const model =
      existing ?? monaco.editor.createModel("", language(path), uri);
    const instance = monaco.editor.create(host.current!, {
      model,
      automaticLayout: true,
      fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
      scrollBeyondLastLine: false,
      padding: { top: 18 },
      tabSize: 2,
      bracketPairColorization: { enabled: true },
      fontSize: settings.fontSize,
      readOnly,
      minimap: { enabled: settings.minimap },
      wordWrap: settings.wrap ? "on" : "off",
      theme: settings.theme === "dark" ? "sync-dark" : "vs",
    });
    editor.current = instance;
    const binding = new MonacoBinding(
      document.doc.getText("content"),
      model,
      new Set([instance]),
      document.awareness,
    );
    const selection = instance.onDidChangeCursorSelection(() => {
      const range = instance.getSelection();
      if (range)
        callback.current({
          text: model.getValueInRange(range),
          line: range.startLineNumber,
          endLine: range.endLineNumber,
        });
    });
    const previousView = viewStates.get(document);
    if (previousView) instance.restoreViewState(previousView);
    if (!existing) document.doc.on("destroy", () => model.dispose());
    onReady(instance);
    return () => {
      onReady(null);
      selection.dispose();
      binding.destroy();
      const view = instance.saveViewState();
      if (view) viewStates.set(document, view);
      instance.dispose();
    };
  }, [document, path]);
  useEffect(() => {
    editor.current?.updateOptions({
      fontSize: settings.fontSize,
      minimap: { enabled: settings.minimap },
      wordWrap: settings.wrap ? "on" : "off",
      readOnly,
    });
    monaco.editor.setTheme(settings.theme === "dark" ? "sync-dark" : "vs");
  }, [settings, readOnly]);
  return <div className="editor-host" ref={host} data-testid="code-editor" />;
}
