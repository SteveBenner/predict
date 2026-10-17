"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const core = require("./predict-core");

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_ERRORS = 20;

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createServer(options) {
  const catalog = readJsonFile(options.catalog);
  const statePath = options.state;
  let rendered = false;

  function readState() {
    try {
      return readJsonFile(statePath);
    } catch (error) {
      return null;
    }
  }

  function writeState(tree) {
    const tmp = `${statePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(tree), { mode: 0o600 });
    fs.renameSync(tmp, statePath);
  }

  function description() {
    return [
      "An interface is one Predict 2.0 document that names catalog modules and their args; the browser renders it, so you never write HTML, CSS or script.",
      "Make exactly one render call per output, because after one accepted render this process refuses every other.",
      'mount: { "op": "mount", "id": ID, "module": NAME, "into": ID or "root", "slot": SLOT, "args": {...} }',
      'set: { "op": "set", "id": ID, "args": {...} } shallow-merges args into a mounted module.',
      'remove: { "op": "remove", "id": ID } removes the module and everything inside it; clear: { "op": "clear" }.',
      'Document: { "predict": "2.0", "mode": "replace" or "patch", "title": string, "ops": [...] }. Modules:',
      core.signatures(catalog)
    ].join("\n");
  }

  function tools() {
    return [
      {
        name: "render",
        description: description(),
        inputSchema: {
          type: "object",
          properties: {
            predict: { type: "string", enum: ["2.0"] },
            mode: { type: "string", enum: ["replace", "patch"] },
            title: { type: "string", maxLength: core.LIMITS.title },
            ops: { type: "array", items: { type: "object" }, maxItems: core.LIMITS.ops }
          },
          required: ["predict", "ops"],
          additionalProperties: false
        }
      },
      {
        name: "describe",
        description: "Answer the full catalog entry of one module as JSON: its args with types and defaults, its slots and whether it emits actions.",
        inputSchema: {
          type: "object",
          properties: { module: { type: "string" } },
          required: ["module"],
          additionalProperties: false
        }
      }
    ];
  }

  function textResult(text, isError) {
    const result = { content: [{ type: "text", text }] };
    if (isError) result.isError = true;
    return result;
  }

  function refusal(errors) {
    const shown = errors.slice(0, MAX_ERRORS);
    const body = { refused: true, errors: shown };
    if (errors.length > shown.length) body.more = errors.length - shown.length;
    return textResult(JSON.stringify(body), true);
  }

  function callRender(args) {
    if (rendered) {
      return refusal([
        {
          index: -1,
          code: "one_interface_per_output",
          path: "",
          message: "Expected one render per output, and this output has already rendered its interface."
        }
      ]);
    }
    const result = core.validate(args, catalog, readState());
    if (!result.ok) return refusal(result.errors);
    writeState(result.tree);
    rendered = true;
    return textResult(`accepted: ${result.tree.modules.length} module(s) on screen`, false);
  }

  function callDescribe(args) {
    const ref = args && args.module;
    const found = catalog.modules.find((m) => m.id === ref) || catalog.modules.find((m) => m.name === ref);
    if (!found) {
      return textResult(
        `Unknown module. Modules: ${catalog.modules.map((m) => m.name).join(", ")}`,
        true
      );
    }
    return textResult(JSON.stringify(found), false);
  }

  function handle(message) {
    if (message === null || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
      return { jsonrpc: "2.0", id: message && message.id !== undefined ? message.id : null, error: { code: -32600, message: "Invalid request" } };
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    const reply = (result) => (hasId ? { jsonrpc: "2.0", id: message.id, result } : null);
    const fail = (code, text) => (hasId ? { jsonrpc: "2.0", id: message.id, error: { code, message: text } } : null);
    const params = message.params && typeof message.params === "object" ? message.params : {};

    switch (message.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "predict", version: core.VERSION }
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: tools() });
      case "tools/call": {
        const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
        if (params.name === "render") return reply(callRender(params.arguments === undefined ? {} : params.arguments));
        if (params.name === "describe") return reply(callDescribe(args));
        return fail(-32602, `Unknown tool: ${params.name}`);
      }
      default:
        if (message.method.startsWith("notifications/")) return null;
        return fail(-32601, `Method not found: ${message.method}`);
    }
  }

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    try {
      return handle(message);
    } catch (error) {
      const id = message && message.id !== undefined ? message.id : null;
      return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
    }
  }

  return { handleLine, tools };
}

function run(options) {
  const server = createServer(options);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const response = server.handleLine(line);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  rl.on("close", () => process.exit(0));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--catalog") out.catalog = argv[++i];
    else if (argv[i] === "--state") out.state = argv[++i];
  }
  return out;
}

module.exports = { createServer, run, parseArgs };

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.catalog || !options.state) {
    process.stderr.write("usage: node mcp.js --catalog FILE --state FILE\n");
    process.exit(2);
  }
  run(options);
}
