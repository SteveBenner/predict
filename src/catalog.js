"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./predict-core");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function build(options) {
  const ruiDir = options.ruiDir;
  const only = options.only && options.only.length ? new Set(options.only) : null;
  const index = readJson(path.join(ruiDir, "catalog.json"));
  const picked = [];
  for (const entry of index.modules || []) {
    if (!Array.isArray(entry.provides) || !entry.provides.includes("component.mount")) continue;
    if (only && !only.has(entry.id)) continue;
    picked.push(entry);
  }
  picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const modules = picked.map((entry) => {
    const shapeFile = path.join(ruiDir, entry.path || entry.id.split(".").join("/"), "shape.json");
    let shape;
    try {
      shape = readJson(shapeFile);
    } catch (error) {
      throw new Error(`module ${entry.id}: cannot read ${shapeFile}: ${error.message}`);
    }
    const contract = shape.contract || {};
    const props = (contract.props || []).map((p) => {
      try {
        core.parseType(p.type);
      } catch (error) {
        throw new Error(`module ${entry.id}, prop ${p.name}: ${error.message}`);
      }
      const hasDefault = Object.prototype.hasOwnProperty.call(p, "default");
      return {
        name: p.name,
        type: p.type,
        required: !hasDefault,
        default: hasDefault ? p.default : null,
        summary: p.summary || ""
      };
    });
    const slots = (contract.slots || []).map((s) => ({ name: s.name, summary: s.summary || "" }));
    const emits = (contract.events || []).some((e) => e.direction === "emits");
    return {
      id: entry.id,
      name: entry.id.split(".").pop(),
      summary: entry.summary,
      kind: entry.kind,
      version: entry.version,
      props,
      slots,
      emits
    };
  });

  const counts = {};
  for (const m of modules) counts[m.name] = (counts[m.name] || 0) + 1;
  for (const m of modules) if (counts[m.name] > 1) m.name = m.id;

  return {
    schema: "predict.catalog/v1",
    predict: "2.0",
    rui_version: index.rui_version || "",
    modules
  };
}

module.exports = { build };
