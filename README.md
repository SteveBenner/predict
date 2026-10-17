# Predict 2.0

Predict 2.0 is a JSON interface language. A producer, usually an AI agent, sends one document of opcodes that name
rui modules and carry typed args. A validator checks the document against a catalog, and a browser runtime mounts
the modules. The producer never writes HTML, CSS or script.

Plain JavaScript, Node 20 or newer, no dependencies, and no build step. This repository contains the current Predict 2 implementation, distributed under the MIT license.

Clone the repository and run `node bin/predict version`. Prefix the commands below with `node bin/` when working directly from the checkout. A compatible rui source directory is supplied explicitly; Predict does not install or contact rStack services.

## The document in one example

```json
{
  "predict": "2.0",
  "mode": "replace",
  "title": "Check-in for Sample Course 101",
  "ops": [
    { "op": "mount", "id": "page", "module": "stack" },
    { "op": "mount", "id": "intro", "module": "heading", "into": "page", "args": { "text": "Week 3", "level": "1" } },
    { "op": "mount", "id": "late", "module": "callout", "into": "page", "args": { "text": "Three submissions are missing.", "tone": "warn" } }
  ]
}
```

Four ops: `mount`, `set` (shallow-merge args), `remove` (with everything inside) and `clear`. `mode` is `replace`
(the tree starts empty) or `patch` (the tree starts as the current interface). A document is accepted whole or
refused whole; a refusal is a list of errors with an op index, a code, a dotted path and one plain sentence. The full
language is in `spec/predict.spec.yml`, and `examples/` holds `checkin.json`, `patch.json` and `refused.json`.

When a module's user interaction fires an action, the host receives `{ name, payload, source, values }`: the name and
payload the agent attached, the module id, and what the module collected.

## Verbs

```
predict catalog build --rui DIR [--only ID ...] [--out FILE]
predict validate FILE --catalog FILE [--tree FILE]
predict signatures --catalog FILE
predict mcp --catalog FILE --state FILE
predict vendor --app DIR --rui DIR
predict check --app DIR
predict version
```

Exit 0 on success, 1 on a refusal or finding (printed as JSON on stdout for `validate`), 2 on usage.

`catalog build` reads a rui checkout and includes only modules that provide `component.mount`. A rui checkout with no
such module yields an empty catalog, which is valid.

`mcp` runs a stdio MCP server named `predict` with two tools. `render` takes a document, validates it against the
catalog and the tree in the state file, writes the new tree atomically when accepted, and refuses every later render
in that process with `one_interface_per_output`. `describe` answers one module's catalog entry.

## Vendoring into an app

`predict vendor --app DIR --rui DIR` copies `predict-core.js`, `predict-runtime.js` and `predict-mcp.js` into
`<app>/vendor/predict/`, builds `predict.catalog.json` there from the modules listed in `<app>/rui.lock`, and writes
`<app>/predict.lock` with a SHA-256 for each file. `predict check --app DIR` fails on drift, a missing file or an
extra file. The vendored `predict-mcp.js` runs with only `predict-core.js` beside it. A `package.json` holding
`{"type": "commonjs"}` is written beside them, so Node loads the files as CommonJS whatever a `package.json`
higher up the tree declares.

`LICENSE` is copied into each vendored distribution and included in its integrity lock.

`SKILL.md`, the agent skill from `skills/predict/SKILL.md`, is vendored beside them and listed in `predict.lock`.
It teaches a model the output grammar: the document, the four ops, the arg types, slots, the actions an interface
sends back, and every refusal code with its fix. It also teaches composition: which skeleton fits which kind of
answer, how to fit regions side by side, what to put behind tabs and details, and how to budget module heights so
the interface fills the screen without scrolling. A host can open each request with `[predict viewport 1126x627]`,
the size of the area it draws in, and may add the dashboard grid's fit
(`, grid 4 rows of 138 px, widget body h1 70, h2 220, h3 370, h4 520 px`); the skill composes for those numbers and
assumes 1100x600 without them. Inject it into the system prompt of the agent that holds the render
tool (Claude Code: `--append-system-prompt-file vendor/predict/SKILL.md`), so the grammar is in context before the
first render rather than learned from refusals. The render tool's own description still carries the module list; the
skill points to it rather than repeating it.

In a page, load `predict-core.js`, `predict-runtime.js` and the module scripts, then:

```js
const host = Predict.createHost({
  target: element,
  catalog,
  resolve: (id) => RUI.components[id] || null,
  onAction: (action) => {},
  onError: (error) => {}
});
host.apply(document);
```

`apply` returns `{ ok: true }` or `{ ok: false, errors }` and changes nothing on failure. `host.tree()` returns the live
tree and `host.setInert(bool)` freezes the target while a turn runs.

## Making a module renderable

A rui module can be mounted from data when it follows the rui component contract (`specs/component-contract.yml` in
rui): kind `component` or `layout`, a vanilla target with `<module>.js` and `<module>.css`, and a
`RUI.components["<id>"]` registration with `render` and an optional `update`. The module declares its props, slots and
events in `module.yml`; `rui catalog` writes them to `shape.json`, and Predict reads that file.

## Limits

300 ops, 200000 bytes of JSON, 2000 characters per string, 8000 per text, 500 items per list, nesting depth 8,
title 120 characters.

## Security posture

The runtime never evaluates strings, never sets `innerHTML`, never follows a URL from a document, and treats every
string as text. It works under `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'`.

## Validation and current limits

The current compatible rui development catalog produces26 mountable modules. The shipped check-in document validates, the refusal document is rejected with structured errors, and vendoring produces a seven-file integrity lock including LICENSE. A host must supply compatible rui module implementations; the catalog alone does not render components.

The browser runtime was previously exercised with scratch components in Chrome. Cross-browser behavior and every compatible rui module combination remain unchecked. This release does not claim a packaged rui distribution or hosted inference service.
