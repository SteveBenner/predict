(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Predict = root.Predict || {};
    root.Predict.core = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "2.2.1";
  var LIMITS = {
    ops: 300,
    bytes: 200000,
    string: 2000,
    text: 8000,
    list: 500,
    depth: 8,
    title: 120,
    key: 60
  };
  var ID_RE = /^[a-z][a-z0-9_-]{0,39}$/;
  var NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
  var KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  var WORD_RE = /^[A-Za-z0-9_.-]+$/;
  var SIMPLE = ["string", "text", "integer", "number", "boolean", "scalar", "action"];
  var LAYOUT_PREFIX = "composite.layout";

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function clone(v) {
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === "object") {
      if (Array.isArray(b)) return false;
      var ka = Object.keys(a);
      var kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) {
        if (!has(b, ka[j]) || !deepEqual(a[ka[j]], b[ka[j]])) return false;
      }
      return true;
    }
    return false;
  }

  function utf8Length(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }

  function parseType(source) {
    if (typeof source !== "string" || source === "") {
      throw new Error("type must be a non-empty string");
    }
    var pos = 0;

    function fail(msg) {
      throw new Error("bad type '" + source + "' at " + pos + ": " + msg);
    }

    function peek(s) {
      return source.substr(pos, s.length) === s;
    }

    function expect(s) {
      if (!peek(s)) fail("expected '" + s + "'");
      pos += s.length;
    }

    function readWord(re) {
      var start = pos;
      while (pos < source.length && /[A-Za-z0-9_.-]/.test(source.charAt(pos))) pos++;
      var w = source.slice(start, pos);
      if (!w || !re.test(w)) fail("expected a name");
      return w;
    }

    function parseOne() {
      var start = pos;
      while (pos < source.length && /[a-z]/.test(source.charAt(pos))) pos++;
      var head = source.slice(start, pos);
      if (head === "enum") {
        expect("(");
        var values = [readWord(WORD_RE)];
        while (peek("|")) {
          pos++;
          values.push(readWord(WORD_RE));
        }
        expect(")");
        var seen = {};
        for (var i = 0; i < values.length; i++) {
          if (seen[values[i]]) fail("duplicate enum value '" + values[i] + "'");
          seen[values[i]] = true;
        }
        return { kind: "enum", values: values };
      }
      if (head === "list" || head === "map") {
        expect("<");
        var inner = parseOne();
        expect(">");
        return { kind: head, of: inner };
      }
      if (head === "record") {
        expect("{");
        var fields = [];
        var names = {};
        for (;;) {
          var name = readWord(KEY_RE);
          var optional = false;
          if (peek("?")) {
            optional = true;
            pos++;
          }
          expect(":");
          if (names[name]) fail("duplicate key '" + name + "'");
          names[name] = true;
          fields.push({ name: name, optional: optional, type: parseOne() });
          if (peek(",")) {
            pos++;
            continue;
          }
          break;
        }
        expect("}");
        return { kind: "record", fields: fields };
      }
      if (SIMPLE.indexOf(head) >= 0) return { kind: head };
      pos = start;
      fail("unknown type '" + (head || source.charAt(pos)) + "'");
    }

    var parsed = parseOne();
    if (pos !== source.length) fail("unexpected trailing text");
    return parsed;
  }

  function typeName(t) {
    return t.kind;
  }

  function checkValue(t, value, path, index, errors) {
    function bad(msg) {
      errors.push({ index: index, code: "bad_type", path: path, message: msg });
    }
    function limit(msg) {
      errors.push({ index: index, code: "limit_exceeded", path: path, message: msg });
    }
    var i;
    switch (t.kind) {
      case "string":
      case "text":
        if (typeof value !== "string") return bad("Expected " + t.kind + " (a JSON string).");
        if (value.length > (t.kind === "text" ? LIMITS.text : LIMITS.string)) {
          return limit(
            "Expected at most " + (t.kind === "text" ? LIMITS.text : LIMITS.string) + " characters."
          );
        }
        return;
      case "integer":
        if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
          return bad("Expected an integer (a JSON number with no fraction).");
        }
        return;
      case "number":
        if (typeof value !== "number" || !isFinite(value)) return bad("Expected a number.");
        return;
      case "boolean":
        if (typeof value !== "boolean") return bad("Expected true or false.");
        return;
      case "scalar":
        if (value === null || typeof value === "boolean") return;
        if (typeof value === "number") {
          if (!isFinite(value)) return bad("Expected a string, number, boolean or null.");
          return;
        }
        if (typeof value === "string") {
          if (value.length > LIMITS.string) {
            return limit("Expected at most " + LIMITS.string + " characters.");
          }
          return;
        }
        return bad("Expected a string, number, boolean or null.");
      case "action":
        if (!isObject(value)) return bad("Expected an action object with a name.");
        var keys = Object.keys(value);
        for (i = 0; i < keys.length; i++) {
          if (keys[i] !== "name" && keys[i] !== "payload") {
            return bad("Expected an action with only name and payload, not '" + keys[i] + "'.");
          }
        }
        if (typeof value.name !== "string" || !NAME_RE.test(value.name)) {
          return bad("Expected an action name matching " + NAME_RE.source + ".");
        }
        if (has(value, "payload")) {
          checkValue(
            { kind: "map", of: { kind: "scalar" } },
            value.payload,
            path + ".payload",
            index,
            errors
          );
        }
        return;
      case "enum":
        if (typeof value !== "string" || t.values.indexOf(value) < 0) {
          return bad("Expected one of these JSON strings: " + t.values.map(function (v) { return JSON.stringify(v); }).join(", ") + ".");
        }
        return;
      case "list":
        if (!Array.isArray(value)) return bad("Expected a list.");
        if (value.length > LIMITS.list) {
          return limit("Expected at most " + LIMITS.list + " items.");
        }
        for (i = 0; i < value.length; i++) {
          checkValue(t.of, value[i], path + "[" + i + "]", index, errors);
        }
        return;
      case "map":
        if (!isObject(value)) return bad("Expected an object.");
        var mk = Object.keys(value);
        for (i = 0; i < mk.length; i++) {
          if (mk[i].length < 1 || mk[i].length > LIMITS.key) {
            bad("Expected object keys of 1 to " + LIMITS.key + " characters.");
            continue;
          }
          checkValue(t.of, value[mk[i]], path + "." + mk[i], index, errors);
        }
        return;
      case "record":
        if (!isObject(value)) return bad("Expected an object.");
        var rk = Object.keys(value);
        var names = {};
        for (i = 0; i < t.fields.length; i++) names[t.fields[i].name] = t.fields[i];
        for (i = 0; i < rk.length; i++) {
          if (!has(names, rk[i])) {
            errors.push({
              index: index,
              code: "bad_type",
              path: path + "." + rk[i],
              message: "Expected only the keys " + t.fields.map(function (f) { return f.name; }).join(", ") + "."
            });
          }
        }
        for (i = 0; i < t.fields.length; i++) {
          var f = t.fields[i];
          if (!has(value, f.name)) {
            if (!f.optional) {
              errors.push({
                index: index,
                code: "bad_type",
                path: path + "." + f.name,
                message: "Expected the required key " + f.name + "."
              });
            }
            continue;
          }
          checkValue(f.type, value[f.name], path + "." + f.name, index, errors);
        }
        return;
    }
    return bad("Expected " + typeName(t) + ".");
  }

  var typeCache = typeof WeakMap === "function" ? new WeakMap() : null;

  function propType(prop) {
    if (typeCache && typeCache.has(prop)) return typeCache.get(prop);
    var parsed = parseType(prop.type);
    if (typeCache) typeCache.set(prop, parsed);
    return parsed;
  }

  function lookupModule(catalog, ref) {
    var mods = (catalog && catalog.modules) || [];
    var i;
    for (i = 0; i < mods.length; i++) if (mods[i].id === ref) return mods[i];
    for (i = 0; i < mods.length; i++) if (mods[i].name === ref) return mods[i];
    return null;
  }

  function checkArgs(mod, given, basePath, index, errors, isSet) {
    var props = mod.props || [];
    var byName = {};
    var i;
    for (i = 0; i < props.length; i++) byName[props[i].name] = props[i];
    var keys = Object.keys(given);
    for (i = 0; i < keys.length; i++) {
      if (!has(byName, keys[i])) {
        errors.push({
          index: index,
          code: "unknown_arg",
          path: basePath + "." + keys[i],
          message:
            "Module " + mod.name + " has no arg " + keys[i] + "; its args are " +
            (props.map(function (p) { return p.name; }).join(", ") || "none") + "."
        });
      }
    }
    for (i = 0; i < props.length; i++) {
      var p = props[i];
      var path = basePath + "." + p.name;
      if (has(given, p.name)) {
        if (!p.required && has(p, "default") && deepEqual(given[p.name], p.default)) continue;
        var type;
        try {
          type = propType(p);
        } catch (e) {
          errors.push({ index: index, code: "bad_type", path: path, message: e.message });
          continue;
        }
        checkValue(type, given[p.name], path, index, errors);
      } else if (p.required && !isSet) {
        errors.push({
          index: index,
          code: "missing_arg",
          path: path,
          message: "Module " + mod.name + " needs the arg " + p.name + " of type " + p.type + "."
        });
      }
    }
  }

  function mergeDefaults(mod, given) {
    var out = {};
    var props = mod.props || [];
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (has(given, p.name)) out[p.name] = clone(given[p.name]);
      else if (!p.required && has(p, "default")) out[p.name] = clone(p.default);
    }
    return out;
  }

  function slotNames(mod, args) {
    var out = [];
    var slots = mod.slots || [];
    for (var i = 0; i < slots.length; i++) {
      var name = slots[i].name;
      var m = /^([^\[\]]+)\[\]\.(.+)$/.exec(name);
      if (!m) {
        out.push(name);
        continue;
      }
      var list = args && args[m[1]];
      if (Array.isArray(list)) {
        for (var j = 0; j < list.length; j++) {
          if (isObject(list[j]) && typeof list[j][m[2]] === "string") out.push(list[j][m[2]]);
        }
      }
    }
    return out;
  }

  function validate(document, catalog, tree) {
    var errors = [];

    function fail() {
      return { ok: false, errors: errors, tree: null };
    }

    if (!isObject(document)) {
      errors.push({ index: -1, code: "bad_document", path: "", message: "Expected the document to be a JSON object." });
      return fail();
    }

    var json;
    try {
      json = JSON.stringify(document);
    } catch (e) {
      json = undefined;
    }
    if (typeof json !== "string") {
      errors.push({ index: -1, code: "bad_document", path: "", message: "Expected the document to be plain JSON." });
      return fail();
    }
    if (utf8Length(json) > LIMITS.bytes) {
      errors.push({
        index: -1,
        code: "limit_exceeded",
        path: "",
        message: "Expected the document to be at most " + LIMITS.bytes + " bytes of JSON."
      });
      return fail();
    }

    var docKeys = Object.keys(document);
    var i;
    for (i = 0; i < docKeys.length; i++) {
      if (["predict", "mode", "title", "ops"].indexOf(docKeys[i]) < 0) {
        errors.push({
          index: -1,
          code: "bad_document",
          path: docKeys[i],
          message: "Expected only predict, mode, title and ops at the top level, not '" + docKeys[i] + "'."
        });
      }
    }
    if (document.predict !== "2.0") {
      errors.push({ index: -1, code: "bad_document", path: "predict", message: 'Expected predict to be "2.0".' });
    }
    var mode = has(document, "mode") ? document.mode : "replace";
    if (mode !== "replace" && mode !== "patch") {
      errors.push({ index: -1, code: "bad_document", path: "mode", message: 'Expected mode to be "replace" or "patch".' });
    }
    if (has(document, "title")) {
      if (typeof document.title !== "string") {
        errors.push({ index: -1, code: "bad_document", path: "title", message: "Expected title to be a string." });
      } else if (document.title.length > LIMITS.title) {
        errors.push({
          index: -1,
          code: "limit_exceeded",
          path: "title",
          message: "Expected title to be at most " + LIMITS.title + " characters."
        });
      }
    }
    if (!Array.isArray(document.ops)) {
      errors.push({ index: -1, code: "bad_document", path: "ops", message: "Expected ops to be a list of operations." });
    } else if (document.ops.length > LIMITS.ops) {
      errors.push({
        index: -1,
        code: "limit_exceeded",
        path: "ops",
        message: "Expected at most " + LIMITS.ops + " ops."
      });
    }
    if (errors.length) return fail();

    var live = [];
    var title = null;
    if (mode === "patch") {
      if (!isObject(tree) || !Array.isArray(tree.modules)) {
        errors.push({
          index: -1,
          code: "no_current_interface",
          path: "mode",
          message: "Expected a current interface for patch mode, but none is showing."
        });
        return fail();
      }
      live = clone(tree.modules);
      title = typeof tree.title === "string" ? tree.title : null;
    }
    if (typeof document.title === "string") title = document.title;

    function find(id) {
      for (var k = 0; k < live.length; k++) if (live[k].id === id) return live[k];
      return null;
    }

    function depthOf(entry) {
      var d = 1;
      var cur = entry;
      while (cur && cur.into !== "root") {
        cur = find(cur.into);
        d++;
      }
      return d;
    }

    function descendants(id) {
      var ids = {};
      ids[id] = true;
      var out = [id];
      for (var k = 0; k < live.length; k++) {
        if (ids[live[k].into]) {
          ids[live[k].id] = true;
          out.push(live[k].id);
        }
      }
      return out;
    }

    function removeIds(list) {
      var set = {};
      for (var k = 0; k < list.length; k++) set[list[k]] = true;
      live = live.filter(function (e) { return !set[e.id]; });
    }

    function slotsStillValid(entry, index, errs) {
      var mod = lookupModule(catalog, entry.module);
      var ok = slotNames(mod, entry.args);
      for (var k = 0; k < live.length; k++) {
        if (live[k].into === entry.id && ok.indexOf(live[k].slot) < 0) {
          errs.push({
            index: index,
            code: "unknown_slot",
            path: "args",
            message: "Module " + live[k].id + " sits in slot " + live[k].slot + " of " + entry.id + ", which would no longer exist."
          });
        }
      }
    }

    var ops = document.ops;
    for (i = 0; i < ops.length; i++) {
      var op = ops[i];
      var before = errors.length;
      var p;
      if (!isObject(op) || typeof op.op !== "string") {
        errors.push({ index: i, code: "bad_op", path: "op", message: "Expected an op object with an op name of mount, set, remove or clear." });
        continue;
      }
      var allowed = {
        mount: ["op", "id", "module", "into", "slot", "args"],
        set: ["op", "id", "args"],
        remove: ["op", "id"],
        clear: ["op"]
      }[op.op];
      if (!allowed) {
        errors.push({ index: i, code: "bad_op", path: "op", message: "Expected op to be mount, set, remove or clear." });
        continue;
      }
      var opKeys = Object.keys(op);
      for (p = 0; p < opKeys.length; p++) {
        if (allowed.indexOf(opKeys[p]) < 0) {
          errors.push({
            index: i,
            code: "bad_op",
            path: opKeys[p],
            message: "Expected a " + op.op + " op to have only " + allowed.join(", ") + ", not '" + opKeys[p] + "'."
          });
        }
      }

      if (op.op === "clear") {
        if (errors.length === before) live = [];
        continue;
      }

      var idOk = false;
      if (typeof op.id !== "string" || !ID_RE.test(op.id) || op.id === "root") {
        errors.push({
          index: i,
          code: "bad_id",
          path: "id",
          message: 'Expected an id matching ' + ID_RE.source + ' and not "root".'
        });
      } else {
        idOk = true;
      }

      if (op.op === "remove") {
        if (idOk && !find(op.id)) {
          errors.push({ index: i, code: "unknown_target", path: "id", message: "Expected the id of a live module, but " + op.id + " is not live." });
        }
        if (errors.length === before) removeIds(descendants(op.id));
        continue;
      }

      if (op.op === "set") {
        var target = idOk ? find(op.id) : null;
        if (idOk && !target) {
          errors.push({ index: i, code: "unknown_target", path: "id", message: "Expected the id of a live module, but " + op.id + " is not live." });
        }
        if (!isObject(op.args)) {
          errors.push({ index: i, code: "bad_op", path: "args", message: "Expected set to carry an args object." });
        } else if (target) {
          var tmod = lookupModule(catalog, target.module);
          var errsHere = [];
          checkArgs(tmod, op.args, "args", i, errsHere, true);
          if (!errsHere.length) {
            var merged = {};
            var tk = Object.keys(target.args);
            var q;
            for (q = 0; q < tk.length; q++) merged[tk[q]] = target.args[tk[q]];
            var sk = Object.keys(op.args);
            for (q = 0; q < sk.length; q++) merged[sk[q]] = clone(op.args[sk[q]]);
            var probe = { id: target.id, module: target.module, args: merged };
            slotsStillValid(probe, i, errsHere);
            if (!errsHere.length && errors.length === before) target.args = merged;
          }
          for (q = 0; q < errsHere.length; q++) errors.push(errsHere[q]);
        }
        continue;
      }

      var mod = null;
      if (typeof op.module !== "string") {
        errors.push({ index: i, code: "unknown_module", path: "module", message: "Expected module to be the name or id of a catalog module." });
      } else {
        mod = lookupModule(catalog, op.module);
        if (!mod) {
          errors.push({ index: i, code: "unknown_module", path: "module", message: "Expected a module in the catalog, but " + op.module + " is not one." });
        }
      }
      if (idOk && find(op.id)) {
        errors.push({ index: i, code: "duplicate_id", path: "id", message: "Expected a unique id, but " + op.id + " is already live." });
      }

      var into = has(op, "into") ? op.into : "root";
      var parent = null;
      var intoOk = false;
      if (typeof into !== "string" || (into !== "root" && !ID_RE.test(into))) {
        errors.push({ index: i, code: "bad_id", path: "into", message: 'Expected into to be "root" or the id of a live module.' });
      } else if (into !== "root") {
        parent = find(into);
        if (!parent) {
          errors.push({ index: i, code: "unknown_target", path: "into", message: "Expected the id of a live module, but " + into + " is not live." });
        } else {
          intoOk = true;
        }
      } else {
        intoOk = true;
      }

      var slot = null;
      if (has(op, "slot") && typeof op.slot !== "string") {
        errors.push({ index: i, code: "bad_type", path: "slot", message: "Expected slot to be a string." });
      } else if (intoOk && parent) {
        var pmod = lookupModule(catalog, parent.module);
        if (!pmod.slots || !pmod.slots.length) {
          errors.push({ index: i, code: "not_a_container", path: "into", message: "Expected a module that declares a slot, but " + into + " declares none." });
        } else {
          var names = slotNames(pmod, parent.args);
          if (has(op, "slot")) {
            if (names.indexOf(op.slot) < 0) {
              errors.push({
                index: i,
                code: "unknown_slot",
                path: "slot",
                message: "Expected one of the slots of " + into + ": " + (names.join(", ") || "none") + "."
              });
            } else {
              slot = op.slot;
            }
          } else if (names.length) {
            slot = names[0];
          } else {
            errors.push({ index: i, code: "unknown_slot", path: "slot", message: "Expected " + into + " to have a slot, but it has no slot instances yet." });
          }
        }
      } else if (intoOk && has(op, "slot")) {
        errors.push({ index: i, code: "unknown_slot", path: "slot", message: "Expected no slot when mounting into root." });
      }

      if (mod && intoOk) {
        var d = 1;
        var anc = parent;
        var clash = false;
        while (anc) {
          d++;
          if (anc.module === mod.id && mod.id.indexOf(LAYOUT_PREFIX) !== 0) clash = true;
          anc = anc.into === "root" ? null : find(anc.into);
        }
        if (clash) {
          errors.push({ index: i, code: "nesting_refused", path: "module", message: "Expected no ancestor with the same module " + mod.id + "." });
        }
        if (d > LIMITS.depth) {
          errors.push({ index: i, code: "nesting_refused", path: "into", message: "Expected a nesting depth of at most " + LIMITS.depth + "." });
        }
      }

      var argsGiven = {};
      if (has(op, "args")) {
        if (!isObject(op.args)) {
          errors.push({ index: i, code: "bad_type", path: "args", message: "Expected args to be an object." });
        } else {
          argsGiven = op.args;
          if (mod) checkArgs(mod, argsGiven, "args", i, errors, false);
        }
      } else if (mod) {
        checkArgs(mod, argsGiven, "args", i, errors, false);
      }

      if (errors.length === before && mod) {
        live.push({
          id: op.id,
          module: mod.id,
          into: into,
          slot: into === "root" ? null : slot,
          args: mergeDefaults(mod, argsGiven)
        });
      }
    }

    if (errors.length) return fail();
    return {
      ok: true,
      errors: [],
      tree: { schema: "predict.tree/v1", predict: "2.0", title: title, modules: live }
    };
  }

  function treeToDocument(tree) {
    var doc = { predict: "2.0", mode: "replace" };
    if (tree && typeof tree.title === "string") doc.title = tree.title;
    doc.ops = ((tree && tree.modules) || []).map(function (m) {
      var op = { op: "mount", id: m.id, module: m.module, into: m.into };
      if (m.slot !== null && m.slot !== undefined) op.slot = m.slot;
      op.args = clone(m.args);
      return op;
    });
    return doc;
  }

  function signatures(catalog) {
    return ((catalog && catalog.modules) || [])
      .map(function (m) {
        var props = (m.props || [])
          .map(function (p) {
            var optional = !p.required;
            return p.name + (optional ? "?" : "") + ": " + p.type;
          })
          .join(", ");
        var slots = (m.slots || []).map(function (s) { return s.name; });
        return (
          m.name + "(" + props + ")" +
          (slots.length ? " [slots: " + slots.join(", ") + "]" : "") +
          " - " + m.summary
        );
      })
      .join("\n");
  }

  return {
    VERSION: VERSION,
    LIMITS: LIMITS,
    parseType: parseType,
    validate: validate,
    treeToDocument: treeToDocument,
    signatures: signatures
  };
});
