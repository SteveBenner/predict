"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const catalogBuilder = require("./catalog");
const core = require("./predict-core");

const LOCK_SCHEMA = "predict.lock/v1";
const VENDOR_DIR = path.join("vendor", "predict");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function lockedModuleIds(app) {
  const file = path.join(app, "rui.lock");
  if (!fs.existsSync(file)) throw new Error(`${file} does not exist`);
  const ids = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*-\s+id:\s*"?([^\s"]+)"?\s*$/.exec(line);
    if (match) ids.push(match[1]);
  }
  return ids;
}

function listFiles(dir, base) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.posix.join(base, name);
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

function vendor(options) {
  const app = path.resolve(options.app);
  const ruiDir = path.resolve(options.ruiDir);
  const here = __dirname;
  const target = path.join(app, VENDOR_DIR);
  fs.mkdirSync(target, { recursive: true });

  fs.copyFileSync(path.join(here, "predict-core.js"), path.join(target, "predict-core.js"));
  fs.copyFileSync(path.join(here, "predict-runtime.js"), path.join(target, "predict-runtime.js"));
  const mcp = fs.readFileSync(path.join(here, "mcp.js"), "utf8");
  const rewritten = mcp.replace(/require\((["'])\.\/predict-core(?:\.js)?\1\)/g, 'require("./predict-core.js")');
  fs.writeFileSync(path.join(target, "predict-mcp.js"), rewritten);
  fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
  fs.copyFileSync(path.join(here, "..", "skills", "predict", "SKILL.md"), path.join(target, "SKILL.md"));

  fs.copyFileSync(path.join(here, "..", "LICENSE"), path.join(target, "LICENSE"));

  const catalog = catalogBuilder.build({ ruiDir, only: lockedModuleIds(app) });
  fs.writeFileSync(path.join(target, "predict.catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

  const files = listFiles(target, "vendor/predict")
    .map((rel) => ({ path: rel, sha256: sha256(fs.readFileSync(path.join(app, rel))) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lock = {
    schema: LOCK_SCHEMA,
    predict_version: core.VERSION,
    rui_version: catalog.rui_version,
    files
  };
  fs.writeFileSync(path.join(app, "predict.lock"), `${JSON.stringify(lock, null, 2)}\n`);
  return { lock, modules: catalog.modules.length };
}

function check(options) {
  const app = path.resolve(options.app);
  const findings = [];
  const lockFile = path.join(app, "predict.lock");
  if (!fs.existsSync(lockFile)) return { ok: false, findings: ["predict.lock is missing"] };
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch (error) {
    return { ok: false, findings: [`predict.lock is not valid JSON: ${error.message}`] };
  }
  if (lock.schema !== LOCK_SCHEMA || !Array.isArray(lock.files)) {
    return { ok: false, findings: ["predict.lock is not a predict.lock/v1 file"] };
  }
  const listed = new Set();
  for (const item of lock.files) {
    listed.add(item.path);
    const full = path.join(app, item.path);
    if (!fs.existsSync(full)) findings.push(`missing: ${item.path}`);
    else if (sha256(fs.readFileSync(full)) !== item.sha256) findings.push(`drift: ${item.path}`);
  }
  for (const rel of listFiles(path.join(app, VENDOR_DIR), "vendor/predict")) {
    if (!listed.has(rel)) findings.push(`extra: ${rel}`);
  }
  return { ok: findings.length === 0, findings };
}

module.exports = { vendor, check };
