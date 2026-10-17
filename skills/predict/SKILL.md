---
name: predict
description: The Predict 2.0 output grammar and how to compose with it. Use whenever a predict render tool is available and your answer is shown as an interface. It covers the document, the four ops, the arg types, slots, the actions a rendered interface sends back, every refusal code and how to fix it, the viewport marker, and layout: shapes, fitting blocks side by side, nesting, hide and reveal, and the dashboard modules.
---

# Predict 2.0: how to answer with an interface

Your answer is not text. It is one JSON document, sent as the arguments of one `render` call on the predict tool.
A validator checks it against a catalog of modules and a browser mounts those modules. You never write HTML, CSS,
script or Markdown. Every string you send is shown as plain text.

The `render` tool's description lists every module you may name, one per line:
`NAME(prop: type, prop?: type) [slots: a, b] - summary`. A prop marked `?` has a default and may be left out; every
other prop is required. That list is the only vocabulary. When a prop is unclear, call `describe` with the module
name; it answers the full entry (types, defaults, slots, whether it emits actions).

## One render per output

- Make exactly one accepted `render` call per output. After one is accepted, every later `render` in the same
  output is refused with `one_interface_per_output`.
- A refused render changes nothing. Fix exactly what each error names and call `render` again.
- The accepted interface replaces what the user sees, so it must carry everything they should see now.

## The document

```json
{ "predict": "2.0", "mode": "replace", "title": "Week 3 check-in", "ops": [ ... ] }
```

| key | rule |
| --- | --- |
| `predict` | always the string `"2.0"` |
| `mode` | `"replace"` (the default) builds from an empty screen; `"patch"` edits the interface already showing |
| `title` | optional, at most 120 characters; the interface's accessible name. A patch without a title keeps the old one |
| `ops` | the list of operations, applied in order |

No other top-level key is allowed. These four keys are the arguments of the `render` call themselves: do not wrap
them in another key such as `args` or `document`, and do not send the document as a string.

## The four ops

```json
{ "op": "mount",  "id": "ID", "module": "NAME", "into": "ID or root", "slot": "SLOT", "args": { } }
{ "op": "set",    "id": "ID", "args": { } }
{ "op": "remove", "id": "ID" }
{ "op": "clear" }
```

- `mount` places a new module. `into` defaults to `"root"`. `args` are checked against the module's props.
- `set` shallow-merges `args` into a mounted module's current args; the merged result is checked again. To change
  one row of a table, send the whole `rows` list.
- `remove` takes out a module and everything mounted inside it.
- `clear` takes out everything.
- In replace mode, `set` and `remove` may only name ids mounted earlier in the same document.
- In patch mode, ops start from the interface already showing; a patch with nothing showing is refused.

### Ids

An id matches `^[a-z][a-z0-9_-]{0,39}$`: lowercase, starts with a letter, at most 40 characters. It is unique among
the modules on screen. `root` is reserved. Use readable ids (`stats`, `late-work`, `roster`), because a later patch
and every action name modules by id.

### Placement and slots

- A mount into `root` carries no `slot`. Naming one is refused.
- A mount into a module needs that module to declare a slot. `slot` defaults to its first slot.
- Containers and their slots: `card` (body), `details` (body), `stack` (items), `columns` (items), and `tabs`, whose
  slots are a family `tabs[].key`: one slot per tab, named by that tab's `key`.
- When the render tool lists them: `widget` (body) and `dashboard-grid`, whose slots are a family `items[].id`: one
  slot per item, named by that item's `id`.
- A parent must be mounted before its children.

```json
{ "op": "mount", "id": "views", "module": "tabs", "args": { "tabs": [ { "key": "due", "label": "Due" }, { "key": "done", "label": "Done" } ] } },
{ "op": "mount", "id": "due-list", "module": "list", "into": "views", "slot": "due", "args": { "items": [ { "text": "Grade Assignment 2" } ] } }
```

### Nesting and size limits

- No module may sit inside another module of the same kind (a card in a card, details in details). Layout modules
  (`stack`, `columns`, `dashboard-grid`) are the exception and may nest in themselves.
- Depth is at most 8, with root at 0.
- At most 300 ops and 200000 bytes of JSON per document. A `string` is at most 2000 characters, a `text` at most
  8000, a list at most 500 items, a map key 1 to 60 characters.

## Arg types

Each prop's type in the module list is one of these. Send exactly the JSON shape shown.

| type | JSON value | example |
| --- | --- | --- |
| `string` | a string, at most 2000 characters | `"Assignment 2"` |
| `text` | a string, at most 8000 characters; blank lines split paragraphs | `"First point.\n\nSecond point."` |
| `integer` | a number with no fraction | `3` |
| `number` | any number | `17.5` |
| `boolean` | `true` or `false` | `true` |
| `scalar` | a string, number, boolean or `null` | `91`, `"missing"`, `null` |
| `enum(a\|b\|c)` | one listed word, **always a JSON string**, even when it looks like a number | `"warn"`, `"2"` |
| `list<T>` | an array of T | `[ ... ]` |
| `map<T>` | an object with string keys, values T | `{ "student": "A", "score": 91 }` |
| `record{k:T,k?:T}` | an object with exactly these keys; `k?` is optional; any other key is refused | `{ "key": "due", "label": "Due" }` |
| `action` | `{ "name": NAME, "payload": map<scalar>? }`, NAME matches `^[a-z][a-z0-9_]{0,39}$` | `{ "name": "open_student", "payload": { "week": 3 } }` |

The mistakes refused most often:

- An enum sent as a number: `"level": 1` is refused; send `"level": "1"`.
- A record with an extra or misspelled key: `{ "key": "x", "title": "X" }` where the record wants `label`
  (refused as `bad_type`).
- A missing required prop, for example a `stat` without `value`.
- A number where a `string` is wanted: a stat's `value` is a string, so send `"24"`.
- A `slot` on a mount into `root`.

A value equal to the prop's default is always accepted, so `null` for an action prop whose default is null means no
action.

## Actions: how the user answers you

A module whose prop has type `action` sends that action back when the user acts on it. Your next input then carries:

```json
{ "name": "choose_next", "source": "next", "payload": { "week": 3 }, "values": { "next_step": "remind" } }
```

`name` and `payload` are what you attached, `source` is the module's id, and `values` is what the module collected:

| module | prop | values sent |
| --- | --- | --- |
| `button` | `action` | `{}` |
| `list` | `items[].action` | `{ "text": the item's text }` |
| `table` | `row_action` | the whole row, keyed by column key |
| `choice`, `select` | `action` | `{ NAME: the chosen value }`, NAME being the module's `name` arg |
| `text` | `action` (on Enter) | `{ NAME: the typed text }` |
| `form` | `action` (on a valid submit) | `{ field name: value }` for every field; required fields are checked first |

Put in `payload` whatever you need to recognize the action later (a course, a week, a draft id), because the
values alone may not say which question they answer. To ask a question, render a `choice` or a `form` whose action
carries the answer. Never assume an approval the user has not clicked.

## Replace or patch

- Use `replace` for every new answer. It is the whole screen.
- Use `patch` only for a small change to what is showing: a status that moved, a row added, a callout removed.
  Ids from the interface on screen keep working in a patch.

```json
{ "predict": "2.0", "mode": "patch", "ops": [
  { "op": "set", "id": "submitted", "args": { "value": "18", "tone": "ok" } },
  { "op": "remove", "id": "late" }
] }
```

## Refusals and how to fix them

A refused render answers `{ "refused": true, "errors": [ ... ] }`. Each error is
`{ "index": op index or -1 for the document, "code", "path", "message" }`. `path` points into the op, for example
`args.rows[3].due`. One error refuses the whole document; nothing on screen changes.

| code | means | fix |
| --- | --- | --- |
| `bad_document` | the top level is wrong (missing `predict` or `ops`, extra key, bad `mode`, long `title`) | send exactly `predict`, `mode`, `title`, `ops` |
| `bad_op` | an op has an unknown `op`, a missing field or an extra key, or a module failed to draw | use the op shapes above |
| `bad_id` | an id breaks the id pattern or uses `root` | lowercase letters, digits, `-` and `_`, starting with a letter |
| `duplicate_id` | the id is already on screen or earlier in the document | pick a new id, or `remove` the old one first |
| `unknown_module` | the module is not in the catalog | use a name from the render tool's list |
| `unknown_target` | `into`, `set` or `remove` names an id that is not mounted | mount the parent first; in replace mode only same-document ids exist |
| `not_a_container` | `into` names a module with no slots | mount into a `card`, `details`, `stack`, `columns`, `tabs` or `root` |
| `unknown_slot` | the slot does not exist on the target, or a slot was given for `root` | use a declared slot; drop `slot` for root |
| `unknown_arg` | an arg the module does not declare | remove it; the message lists the real args |
| `missing_arg` | a required arg is absent | add it |
| `bad_type` | a value has the wrong type, an enum word is not listed, or a record has an extra, missing or misspelled key | match the type table; enums are strings; the message names the expected keys |
| `nesting_refused` | a module inside its own kind, or deeper than 8 | flatten it, or use a `stack` |
| `limit_exceeded` | too many ops, items or characters | shorten; summarize long lists |
| `no_current_interface` | a patch with nothing on screen | send a replace document |
| `one_interface_per_output` | an interface was already accepted in this output | stop; the answer is on screen |

## The viewport

A request may open with a marker the host adds: `[predict viewport 1126x627]`. It is the width and height, in CSS
pixels, of the area your interface is drawn in. It is not part of what the user typed. Compose for that area:

- The height is the first screen. Fill it, and stop there: whatever the user must see to act belongs on it, and
  depth goes behind tabs, details and panels that scroll inside themselves, never into a longer page. Half a screen
  left empty is as wrong as a page that scrolls.
- 900 or wider: place regions side by side. 600 to 899: at most two columns. Under 600: one column, and lean harder
  on tabs and details.
- With no marker, assume 1100x600.

The marker may also carry the dashboard grid's fit:
`[predict viewport 1126x627, grid 4 rows of 138 px, widget body h1 70, h2 220, h3 370, h4 520 px]`. The host has
sized the grid's rows so that exactly that many fill the height, and it states how tall the inside of a widget is at
each height `h`. Section 5 below uses these numbers.

## Composing the interface

A plain column of full-width blocks is the weakest interface you can send. Decide the shape first, then fill it.

### 1. Name the kind of answer, then take its shape

Decide the kind in this order and stop at the first that fits. The last column applies when the render tool lists
the dashboard modules (section 5); R is the number of grid rows that fit and bands are written `w x h`.

| | the answer is | with the base modules | on the dashboard grid |
| --- | --- | --- | --- |
| 1 | a decision: the user must choose or supply something before you can go on | two lines of context, then the `choice` or `form`; the evidence in `details` below | the question `5 x R` (context, then the `choice` or `form`) beside the evidence `7 x R` in tabs |
| 2 | one thing in depth: one course, one student, one assignment, one document | a wide `card` with a tab per facet, beside a `stack` of its facts as `key-value`, what is open, and history in `details` | no strip of numbers: the thing `7 x R` with a tab per facet, beside `5 x R` holding a `stack` of two cards and a `details` |
| 3 | a comparison of two to four things | one `card` per thing in a `columns`, the same layout inside each, and the verdict as a `callout` under them; or one table when they compare column by column | one widget per thing at equal widths (`6 + 6`, `4 + 4 + 4`, `3 + 3 + 3 + 3`) and `h: R-1`; the verdict in a `12 x 1` band under them |
| 4 | a trend or a change over time | the table large, with the two or three numbers that sum it up beside it | the chart `8 x (R-1)` beside a ranked list `4 x (R-1)`; the numbers `12 x 1` under them |
| 5 | a list to work through | a `table` or `list` with a row action, split by state with tabs (Open, Done) | the counts `12 x 1`; then one widget `12 x (R-1)` with a tab per state and a table with a row action |
| 6 | a draft or a document | the text in one region, its facts and actions in a narrow region beside it | the text `8 x R` beside `4 x R` holding its facts and the actions |
| 7 | several separate questions of equal weight | one `card` per question in a `columns` | four widgets, `6 + 6` over `6 + 6`, each half of R high; with an odd R, three widgets `4 + 4 + 4` at `h: R` |
| 8 | an overview across several things | a strip of numbers on top, then a wide main region beside a narrow one that holds what needs attention, then the one next step | the numbers `12 x 1`; then the main region `8 x (R-1)` beside what needs attention `4 x (R-1)` |

Two answers of different kinds must not look the same. Look at the interface you sent last in this conversation:
when this answer is of another kind, its skeleton must differ (other regions, other widths, the numbers in another
place or left out). A strip of numbers is not a header you owe every answer: only kinds 5 and 8 open with one.

### 2. Fit blocks around each other

- Mount at most four modules straight into `root`: a header line, the body layout, perhaps a closing action. `root`
  holds the skeleton, not the content.
- Small blocks sit side by side. Numbers go in a `columns` with `min: "narrow"`. Two medium blocks go in a `columns`
  with `min: "wide"`. A header is a horizontal `stack` holding the `heading` and a `badge` or two.
- Pair a wide block with a narrow companion: a table with its `key-value` facts, a chart with a ranked list, a
  draft with its actions. Only a table with many columns earns the full width.
- Neighbors should carry a similar amount. When one side runs long, move its overflow behind a tab or a `details`.
- `columns` gives equal cells: two children share the width half and half; `narrow` fits about six stats on a wide
  screen, `medium` four, `wide` three. Unequal splits need the dashboard grid below.

### 3. Nest with a purpose

You have eight levels. Use them: a region holds views, a view holds content, content holds its detail.

- Typical chains: `columns` > `card` > `tabs` > `table`; `card` > `tabs` > `list`; `stack` > `details` > `key-value`.
- Every container must mean something to the user: a region (a card, a grid cell), a view (a tab) or a disclosure
  (a `details`). Never wrap one module in a container that adds nothing.
- A module cannot sit anywhere inside its own kind, at any depth: a card under a tab that is itself in a card is
  refused, and so is a `tabs` anywhere under another `tabs`. Alternate kinds down the chain: card > tabs > details.

### 4. Hide and reveal

The first screen carries the answer and what needs attention. Everything else is one press away.

- `tabs` for parallel views of the same region. They switch on the spot, with no round trip, so put everything you
  already know behind them.
- `details` for secondary material: method, raw status lines, history, the long tail of a list. Closed by default;
  set `open: true` only on the one the user asked about.
- A long table or list goes inside a panel that scrolls within itself (a grid widget) or behind a tab, not down the
  page.
- Say what is hidden, with its count: "Status, 12 lines", "Late work (3)", "5 more tasks".
- More than about seven rows or items showing in one region is too many; show the top ones and tuck the rest away.
  More than three paragraphs of prose becomes several `details` by topic.
- An action costs a full round trip to you; tabs and details cost nothing. Use actions for what you would have to
  work out, and local reveal for what you already hold.

### 5. The dashboard modules, when the render tool lists them

`dashboard-grid`, `widget`, `kpi`, `stat-row`, `time-series` and `ranked-list` are optional. Use them only when the
render tool's list names them. They give unequal splits, neighbors of equal height, panels that scroll inside
themselves and real charts. When they are listed, the viewport is 900 or wider and the answer has three or more
regions, the grid is the skeleton to use; mount it straight into `root` as the whole interface, with its `title` as
the page heading.

- `dashboard-grid` has 12 columns. Each item has a width `w` (3 to 12) and a height `h` (1 to 4 rows), and at most
  nine items show. Items fill a band from the left until their widths reach 12; the band is as tall as its tallest
  item and its last item stretches to the end, so no cell stays empty. One slot per item, named by the item's `id`.
- Always send `refresh: false` and `editable: false`, and leave `ranges`, `range` and every `on_` action out. They
  belong to a live dashboard whose host stores a layout and feeds it data; in a rendered answer they would be
  buttons that do nothing.
- Mount one `widget` into each slot and the content into the widget's `body`. Its title is the question that region
  answers ("What needs you first?"), not a noun. A `stat-row`, or a `kpi` with no `series`, goes straight into an
  `h: 1` slot with no widget around it.
- Rows. Add up the `h` of your bands, one `h` per band (its tallest item). Use exactly the number of rows the
  marker gives ("grid 4 rows"): fewer leaves the screen part empty, more makes the page scroll. With no grid facts
  in the marker a row is 144 pixels and `floor((H - 25) / 156)` rows fit. Under a heading or inside a tab, one row
  fewer fits. No item is taller than 4, so when more rows fit than one band can use, add a band.
- Skeletons. Section 1 gives the bands for each kind of answer. Take them from the kind, never from habit.
  A band at `h: 1` with no widget is one row high: room for a `stat-row`, one `callout`, or a horizontal `stack`
  of two or three buttons. A widget at `h: 1` holds only two lines. A cell can hold a `stack` of two `card`s when
  one tall region should read as two; only a widget scrolls inside its cell, so anything else must fit the cell:
  `h` rows plus 12 for each gap between them.
- Widths. 12 is one region across; 8 + 4 is a main region with a companion; 6 + 6 two equals; 4 + 4 + 4 three
  equals; 3 is the least and holds one number or a very short list. A table with four or more columns wants 7 or
  more; a chart 6 or more.
- Budget every widget. The marker gives the inside height of a widget at each `h` ("widget body h3 370"); without
  it, count 76, 232, 388 and 544 pixels for `h` 1 to 4. Add up what you put in the body with the sizes below. When
  the sum is over, raise `h`, cut the rows to the top few and say how many are left out, or split the body into
  tabs. A body that scrolls on arrival hides the answer; scrolling is for the user who opens a long tab, not the
  default view.
- `kpi`: `label`, `value`, `period`, and when you know the change, `direction`, `delta` and `basis`; `polarity` says
  which direction is good. A `series` draws a sparkline. `stat-row` holds up to six unframed tiles, and its `focus`
  is the position of the one tile to mark, counting from 0. Give a `series` only when you hold the real numbers
  behind it.
- `time-series` wants `w` of 6 or more and `h` of 3 (2 at the least). `caption` is a sentence saying what the chart
  shows. At most four series, one with `focus: true`. Labels run oldest first. Only chart numbers you hold.
- `ranked-list` is the top few with a `share` bar from 0 to 1 and `more` for the count left out.
- Do not send `chips`, `range`, `pinned`, `updated_at`, `drill_href` or `state` on a widget, or `href` on a ranked
  item. They belong to live dashboards. For alternate views put `tabs` inside the widget.
- Below a 900 pixel width the grid turns into one column and every widget grows to its content, so on a narrow
  viewport use tabs to keep the page short.

### Sizes: count before you send

Heights in pixels at the usual text size, each with the gap to the next item of its kind. Text that wraps adds 23
per extra line, and a narrow region wraps sooner.

| module | height |
| --- | --- |
| `heading` | 28, 23 or 20 by level |
| `prose` | 23 per line |
| `key-value` | 31 per pair; 62 per pair in a region under 400 pixels wide, where the value drops below its key |
| `list` | 31 per item; 55 with a `note`; 42 with an action |
| `ranked-list` | 44 per item; 62 with a note |
| `table` | 40 for the head and 40 per row (51 with a row action); a caption adds 39. Cells do not wrap: keep a cell under 40 characters in a wide region and 20 in a narrow one, or use a `list` with notes |
| `tabs` | 51 for the bar, then the open tab's content. Labels share one line; when they do not fit, the bar wraps and costs 42 more, so keep labels short |
| `details` | 52 closed; open adds its content plus 16 |
| `callout` | 73 with a title and one line of text |
| `choice` | 38 for the label and 49 per option |
| `text` or `select` field | 73, and 16 between fields in a `form` |
| `stat` | 94 |
| `stat-row` | 100; 120 with deltas; 150 with sparklines |
| `kpi` in a frame | 118; 141 with a delta; 185 with a sparkline |
| `badge`, `progress`, `button`, one line of `code` | 26, 39, 41, 41 |
| `card` | 73 around its content |
| the gap between blocks in a `stack` or `columns` | 16 (`tight` 8, `loose` 32) |
| `dashboard-grid` | 25 for its title, 12 between rows and between columns |

A grid region `w` columns wide is about `w / 12` of the viewport width, less 32 inside a widget or a card: at a
viewport 1126 wide, `w: 4` leaves about 340 for content and `w: 8` about 720. Half of a `columns` is half the width.
A sentence of 60 characters needs about 500 pixels to stay on one line.

Outside the grid the same arithmetic applies to the whole page: add up the first screen and compare it with the
viewport height. When it is well short, give the content you tucked away more room (open the one `details` that
matters, show more rows); when it is over, tuck more away.

### 6. Words and tone

- Say what needs attention with a `callout` and a `tone`, not with words like URGENT. One or two callouts, not one
  per sentence.
- Rendered text is plain: no Markdown marks (`**`, `#`, backticks, `-` bullets), no em dash. Use `list` for lists and
  `heading` for headings. Write numbers as the record states them.
- Never put a URL, a file path or a command in a module as if it were a link or a button; nothing is clickable but
  modules with actions.
- Close with the one question or next step (`choice`, `form`, `button`) when there is one.

### Before you call render

1. Does the first screen answer the request without scrolling the page, and is it filled rather than half empty?
2. Is anything side by side, or is it one column? One column is right only under 600 pixels.
3. Is everything secondary behind a tab or a `details`, labeled with its count?
4. Are there four or fewer modules in `root`?
5. On the grid: do the bands add up to the rows that fit, and does each widget's content fit its body height?
6. Which kind did you name in section 1, and is this its skeleton? Is it different from your last interface when
   the kind is different?

## Example: an overview with the base modules

A header line, a strip of numbers, a wide region with one tab per item beside a narrow region of notes and closed
details, and the next step. Twenty ops; `root` holds one stack with four children.

```json
{
  "predict": "2.0",
  "mode": "replace",
  "title": "Week 3 overview",
  "ops": [
    { "op": "mount", "id": "page", "module": "stack" },
    { "op": "mount", "id": "top", "module": "stack", "into": "page", "args": { "direction": "horizontal" } },
    { "op": "mount", "id": "title", "module": "heading", "into": "top", "args": { "text": "Week 3 overview", "level": "1" } },
    { "op": "mount", "id": "flag", "module": "badge", "into": "top", "args": { "text": "1 course needs attention", "tone": "warn" } },
    { "op": "mount", "id": "numbers", "module": "columns", "into": "page", "args": { "min": "narrow" } },
    { "op": "mount", "id": "n-a", "module": "stat", "into": "numbers", "args": { "label": "Course A", "value": "Due today", "note": "Assignment 2", "tone": "warn" } },
    { "op": "mount", "id": "n-b", "module": "stat", "into": "numbers", "args": { "label": "Course B", "value": "0 due", "note": "Next: Quiz 4, Friday", "tone": "ok" } },
    { "op": "mount", "id": "n-q", "module": "stat", "into": "numbers", "args": { "label": "To grade", "value": "17", "note": "12 in Course A" } },
    { "op": "mount", "id": "body", "module": "columns", "into": "page", "args": { "min": "wide" } },
    { "op": "mount", "id": "courses", "module": "card", "into": "body", "args": { "title": "Courses" } },
    { "op": "mount", "id": "views", "module": "tabs", "into": "courses", "args": { "tabs": [ { "key": "a", "label": "Course A" }, { "key": "b", "label": "Course B" } ] } },
    { "op": "mount", "id": "a-work", "module": "table", "into": "views", "slot": "a", "args": {
        "columns": [ { "key": "item", "label": "Item" }, { "key": "due", "label": "Due" }, { "key": "graded", "label": "Graded", "align": "end" } ],
        "rows": [ { "item": "Assignment 2", "due": "Today", "graded": "0 of 24" }, { "item": "Quiz 3", "due": "Last Friday", "graded": "12 of 24" } ],
        "row_action": { "name": "open_item", "payload": { "course": "a" } } } },
    { "op": "mount", "id": "b-work", "module": "list", "into": "views", "slot": "b", "args": { "items": [ { "text": "Quiz 4", "note": "Friday" }, { "text": "Project outline", "note": "In two weeks" } ] } },
    { "op": "mount", "id": "side", "module": "stack", "into": "body", "args": { "gap": "tight" } },
    { "op": "mount", "id": "late", "module": "callout", "into": "side", "args": { "title": "Late work", "text": "Three students have not submitted Assignment 2.", "tone": "warn" } },
    { "op": "mount", "id": "status", "module": "details", "into": "side", "args": { "summary": "Status, 3 lines" } },
    { "op": "mount", "id": "status-facts", "module": "key-value", "into": "status", "args": { "pairs": [ { "key": "Backups", "value": "In sync" }, { "key": "Roster", "value": "24 enrolled" }, { "key": "Last sync", "value": "09:40" } ] } },
    { "op": "mount", "id": "notes", "module": "details", "into": "side", "args": { "summary": "Notes from last week (2)" } },
    { "op": "mount", "id": "notes-list", "module": "list", "into": "notes", "args": { "items": [ { "text": "Move the Quiz 4 date" }, { "text": "Ask about the lab room" } ] } },
    { "op": "mount", "id": "next", "module": "choice", "into": "page", "args": {
        "name": "next_step", "label": "What should we do next?",
        "options": [ { "value": "remind", "label": "Draft a reminder for Assignment 2" }, { "value": "grade", "label": "Grade Quiz 3" } ],
        "action": { "name": "choose_next", "payload": { "week": 3 } } } }
  ]
}
```

## Example: one thing in depth on the dashboard grid

For the marker `[predict viewport 1126x627, grid 4 rows of 138 px, widget body h1 70, h2 220, h3 370, h4 520 px]`:
four rows, one band, no strip of numbers. The thing itself is a widget seven columns wide with a tab per facet; the
five columns beside it hold a stack of two cards and a closed `details`. The open tab is the tab bar, a table head
and three rows with a row action (51 + 40 + 153 = 244 of 520), so the table could grow to eight rows before the
widget scrolls. The side cell is 4 x 138 + 36 = 588 high and holds 197 + 16 + 258 + 16 + 52 = 539.

```json
{
  "predict": "2.0",
  "mode": "replace",
  "title": "Course A in week 3",
  "ops": [
    { "op": "mount", "id": "view", "module": "dashboard-grid", "args": { "title": "Course A in week 3", "refresh": false, "editable": false, "items": [
        { "id": "work", "title": "Work", "w": 7, "h": 4 },
        { "id": "side", "title": "Facts and next step", "w": 5, "h": 4 } ] } },
    { "op": "mount", "id": "work-w", "module": "widget", "into": "view", "slot": "work", "args": { "title": "What is open in Course A?" } },
    { "op": "mount", "id": "facets", "module": "tabs", "into": "work-w", "args": { "tabs": [ { "key": "due", "label": "Due (3)" }, { "key": "grading", "label": "To grade (2)" }, { "key": "changes", "label": "Changes (2)" } ] } },
    { "op": "mount", "id": "due-table", "module": "table", "into": "facets", "slot": "due", "args": {
        "columns": [ { "key": "item", "label": "Item" }, { "key": "due", "label": "Due" }, { "key": "state", "label": "State" } ],
        "rows": [ { "item": "Assignment 2", "due": "Today", "state": "Open" }, { "item": "Quiz 4", "due": "Friday", "state": "Draft" }, { "item": "Project outline", "due": "In two weeks", "state": "Not started" } ],
        "row_action": { "name": "open_item", "payload": { "course": "a" } } } },
    { "op": "mount", "id": "grading-list", "module": "list", "into": "facets", "slot": "grading", "args": { "items": [ { "text": "Quiz 3", "note": "12 of 24 graded" }, { "text": "Assignment 1", "note": "22 of 24 graded" } ] } },
    { "op": "mount", "id": "changes-list", "module": "list", "into": "facets", "slot": "changes", "args": { "items": [ { "text": "Quiz 4 moved to Friday", "note": "Changed on Monday" }, { "text": "Lab room changed", "note": "Changed last week" } ] } },
    { "op": "mount", "id": "side-view", "module": "stack", "into": "view", "slot": "side" },
    { "op": "mount", "id": "facts", "module": "card", "into": "side-view", "args": { "title": "Facts" } },
    { "op": "mount", "id": "facts-list", "module": "key-value", "into": "facts", "args": { "pairs": [ { "key": "Enrolled", "value": "24" }, { "key": "Next session", "value": "Thursday" }, { "key": "Late", "value": "3 students, Assignment 2" }, { "key": "Last sync", "value": "09:40" } ] } },
    { "op": "mount", "id": "step", "module": "card", "into": "side-view", "args": { "title": "Next step" } },
    { "op": "mount", "id": "next", "module": "choice", "into": "step", "args": {
        "name": "next_step", "label": "What should we do first?",
        "options": [ { "value": "remind", "label": "Draft a reminder for Assignment 2" }, { "value": "grade", "label": "Finish grading Quiz 3" }, { "value": "quiz", "label": "Review the Quiz 4 draft" } ],
        "action": { "name": "choose_next", "payload": { "course": "a" } } } },
    { "op": "mount", "id": "history", "module": "details", "into": "side-view", "args": { "summary": "Earlier weeks, 2 lines" } },
    { "op": "mount", "id": "history-list", "module": "list", "into": "history", "args": { "items": [ { "text": "Week 2: all work graded" }, { "text": "Week 1: roster settled at 24" } ] } }
  ]
}
```
