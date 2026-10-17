(function (root) {
  "use strict";

  var core = root.Predict && root.Predict.core;
  if (!core) throw new Error("predict-core.js must be loaded before predict-runtime.js");

  function find(catalog, ref) {
    var mods = (catalog && catalog.modules) || [];
    var i;
    for (i = 0; i < mods.length; i++) if (mods[i].id === ref) return mods[i];
    for (i = 0; i < mods.length; i++) if (mods[i].name === ref) return mods[i];
    return null;
  }

  function createHost(options) {
    var target = options.target;
    var catalog = options.catalog;
    var resolve = options.resolve;
    var onAction = options.onAction || function () {};
    var onError = options.onError || function () {};
    var current = null;
    var records = {};

    function ownSlot(rootEl, name) {
      var all = rootEl.querySelectorAll("[data-rui-slot]");
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute("data-rui-slot") !== name) continue;
        var owner = all[i].parentNode;
        while (owner && owner !== rootEl && !(owner.getAttribute && owner.hasAttribute("data-rui-component"))) {
          owner = owner.parentNode;
        }
        if (owner === rootEl) return all[i];
      }
      return null;
    }

    function makeCtx(ownerId) {
      var ctx = {
        emit: function (action, values) {
          if (!records[ownerId] || !action || typeof action.name !== "string") return;
          onAction({
            name: action.name,
            payload: action.payload || {},
            source: ownerId,
            values: values || {}
          });
        },
        uid: function (suffix) {
          return ownerId + "-" + String(suffix);
        },
        compose: function (moduleId, args) {
          var entry = find(catalog, moduleId);
          if (!entry) throw new Error("compose: unknown module " + moduleId);
          var given = args || {};
          var probed = {};
          var muted = [];
          var props = entry.props || [];
          Object.keys(given).forEach(function (key) {
            var isAction = props.some(function (p) { return p.name === key && p.type === "action"; });
            if (given[key] === null && isAction) {
              muted.push(key);
              probed[key] = { name: "muted" };
            } else {
              probed[key] = given[key];
            }
          });
          var probe = core.validate(
            { predict: "2.0", mode: "replace", ops: [{ op: "mount", id: "compose", module: entry.id, args: probed }] },
            catalog,
            null
          );
          if (!probe.ok) {
            throw new Error("compose: " + probe.errors[0].path + " " + probe.errors[0].message);
          }
          var component = resolve(entry.id);
          if (!component) throw new Error("compose: module " + entry.id + " is not loaded");
          var merged = probe.tree.modules[0].args;
          muted.forEach(function (key) { merged[key] = null; });
          return component.render(merged, ctx);
        }
      };
      return ctx;
    }

    function renderRecord(rec) {
      var component = resolve(rec.module);
      var el = component.render(rec.args, makeCtx(rec.id));
      if (!(el instanceof root.HTMLElement)) {
        throw new Error("module " + rec.module + " did not return an element");
      }
      rec.component = component;
      return el;
    }

    function container(into, slot) {
      if (into === "root") return target;
      var parent = records[into];
      var el = ownSlot(parent.root, slot);
      if (!el) throw new Error("slot " + slot + " of " + into + " is missing");
      return el;
    }

    function dropAll() {
      while (target.firstChild) target.removeChild(target.firstChild);
      records = {};
    }

    function removeRecord(id) {
      var rec = records[id];
      if (!rec) return;
      var ids = [id];
      Object.keys(records).forEach(function (k) {
        var cur = records[k];
        while (cur && cur.into !== "root") {
          if (cur.into === id) {
            ids.push(k);
            return;
          }
          cur = records[cur.into];
        }
      });
      if (rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
      ids.forEach(function (k) {
        delete records[k];
      });
    }

    function mountRecord(entry) {
      var rec = {
        id: entry.id,
        module: entry.module,
        into: entry.into,
        slot: entry.slot,
        args: entry.args
      };
      records[rec.id] = rec;
      rec.root = renderRecord(rec);
      container(entry.into, entry.slot).appendChild(rec.root);
    }

    function updateRecord(id, args) {
      var rec = records[id];
      rec.args = args;
      var ctx = makeCtx(id);
      if (rec.component && typeof rec.component.update === "function") {
        rec.component.update(rec.root, args, ctx);
        return;
      }
      var fresh = renderRecord(rec);
      var old = rec.root;
      var slots = old.querySelectorAll("[data-rui-slot]");
      for (var i = 0; i < slots.length; i++) {
        var name = slots[i].getAttribute("data-rui-slot");
        var owner = slots[i].parentNode;
        while (owner && owner !== old && !(owner.getAttribute && owner.hasAttribute("data-rui-component"))) {
          owner = owner.parentNode;
        }
        if (owner !== old) continue;
        var dest = ownSlot(fresh, name);
        if (!dest) continue;
        while (slots[i].firstChild) dest.appendChild(slots[i].firstChild);
      }
      old.parentNode.replaceChild(fresh, old);
      rec.root = fresh;
    }

    function rebuild(tree) {
      dropAll();
      if (!tree) return;
      tree.modules.forEach(mountRecord);
    }

    function setTitle(title) {
      if (typeof title === "string" && title) target.setAttribute("aria-label", title);
      else target.removeAttribute("aria-label");
    }

    function apply(document) {
      var result = core.validate(document, catalog, current);
      if (!result.ok) return { ok: false, errors: result.errors };
      var ops = document.ops;
      var missing = [];
      for (var i = 0; i < ops.length; i++) {
        if (ops[i].op === "mount") {
          var entry = find(catalog, ops[i].module);
          if (!resolve(entry.id)) {
            missing.push({
              index: i,
              code: "unknown_module",
              path: "module",
              message: "Module " + entry.id + " is in the catalog but is not loaded."
            });
          }
        }
      }
      if (missing.length) return { ok: false, errors: missing };

      var previous = current;
      var mode = document.mode === "patch" ? "patch" : "replace";
      var step = -1;
      try {
        if (mode === "replace") dropAll();
        var live = { schema: "predict.tree/v1", predict: "2.0", title: null, modules: mode === "patch" ? previous.modules : [] };
        for (step = 0; step < ops.length; step++) {
          var op = ops[step];
          var one = core.validate({ predict: "2.0", mode: "patch", ops: [op] }, catalog, live);
          if (!one.ok) throw new Error("replay refused op " + step + ": " + one.errors[0].message);
          if (op.op === "clear") {
            dropAll();
          } else if (op.op === "remove") {
            removeRecord(op.id);
          } else if (op.op === "set") {
            var changed = one.tree.modules.filter(function (m) { return m.id === op.id; })[0];
            updateRecord(op.id, changed.args);
          } else {
            mountRecord(one.tree.modules[one.tree.modules.length - 1]);
          }
          live = one.tree;
        }
      } catch (err) {
        try {
          rebuild(previous);
        } catch (inner) {
          onError(inner);
        }
        onError(err);
        return {
          ok: false,
          errors: [
            {
              index: step,
              code: "bad_op",
              path: "",
              message: "A module failed to render: " + (err && err.message ? err.message : "unknown error") + "."
            }
          ]
        };
      }
      current = result.tree;
      setTitle(current.title);
      return { ok: true };
    }

    return {
      apply: apply,
      tree: function () {
        return current ? JSON.parse(JSON.stringify(current)) : null;
      },
      setInert: function (on) {
        if (on) target.setAttribute("inert", "");
        else target.removeAttribute("inert");
      }
    };
  }

  root.Predict = root.Predict || {};
  root.Predict.createHost = createHost;
})(window);
