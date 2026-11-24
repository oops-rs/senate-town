# Spec: cards — an opaque per-subject document the core stores and serves

The carrier for the Town's custom houses (a chair's blueprint for its
committee) and custom characters (a senator's own look, the person's). Spec
only; nothing is built.

Two rules from the request shape it:
- Nothing of Town lives in the Senate CLI, daemon, server or core crates.
- The core treats a card as generic and opaque. All meaning and all
  validation stay in the app (`src/gen.ts`: `readHouse` and `readLook` read
  only known enumerations and bounded numbers; anything else is ignored).

## What exists today, and why none of it carries a card

| Exists | What it is | Fits? |
| --- | --- | --- |
| **Duty** (`senate_core::duty`) | A `note` whose `meta["duty"]` holds `{senator, duty}`. Folded latest-wins per seat from the committee log. The server checks the writer (the senator, its person, the chair). Set by the MCP `duty` tool; shown in briefs and presence. | **The mechanism fits exactly**, but not the field: a duty is ≤ 300 characters of prose that the Speaker routes `senator::*` questions by and that briefs print. Putting JSON there would break routing and briefs. A card copies the mechanism with its own key. |
| **Aliases** (`senate_core::alias`) | A short name per committee for a primary senator id. | No: a name, not a document; a different lifecycle. |
| **Chat bindings** | Which chat group a committee is bound to. | No: platform plumbing. |
| **The app's local profile** (`LocalProfile`) | The person's name and picture, kept in this app only. | Partly: it can hold the person's own look locally, but agents can't write it and other machines can't see it. |
| **Session titles / status titles** | What a session is doing. | No: transient and text. |

## The card

A card is one JSON value per **subject**, of at most **2 KiB** once
serialised.

The core stores, folds, checks the writer, size-limits and serves it. It
never interprets the value (no schema, no rendering), so it knows nothing
about towns. The Town reads only the keys it knows, from the value's
top-level `town` object (`card.town.house`, `card.town.look`), so other
app features can share the same card later.

### Subjects and who may write

| Subject | Written by | Read by |
| --- | --- | --- |
| a committee | the committee's chair (or the Speaker in person) | anyone who can read the committee |
| a senator (per committee seat) | the senator itself, or the person who owns it | anyone who can read the committee |
| the person | that person (from the app's profile) | the person's own Senate, and the parent's when the person is a principal there |

### In the log (mirroring duty)

- `meta["card"]` on a `note` holds `CardPayload`:

  ```rust
  enum CardSubject { Committee, Senator(SenatorName) }
  struct CardPayload { subject: CardSubject, card: serde_json::Value }
  ```

  A JSON `null` card clears it.
- The server checks on append: the writer may set this subject; the value
  serialises to at most 2048 bytes; at most 16 levels of nesting; and it is
  an object or `null`. Anything else is refused with a clear error, like an
  over-long duty.
- `CardFold`: latest wins per subject, like `DutyFold`.
- The person's card isn't in a committee log. It sits next to the person's
  profile on the server (the principal record), set and read through the
  same API as the profile's other fields.

### Served

- The roster (`RosterCommittee`, `RosterMember`) gains `card: Option<Value>`
  for the committee and for each seat. Same `ipc` read and same uniffi
  record, so the app's existing roster read gets it with no new call.
- The activity watch gains a `card` kind (from the subject, no `line`), so
  the Town redraws a house or a character when its card changes.
- Rate: at most one card change per subject per minute, server-checked.
  Something set by agents shouldn't become a channel.

### Set

- **MCP tool `card`** (beside `duty`):

  ```
  card(subject: "committee" | "me", card: object | null)
  ```

  Without `subject`, it sets the calling senator's own card. A chair may
  set the committee's. Its description says the value is opaque to Senate,
  that apps interpret it, and that it's limited to 2 KiB.
- **CLI:** `senate card set|show|clear [--committee] <file.json>`, for
  people and scripts.
- **The app:** the person edits their own look in the profile, with pickers
  over the Town's enumerations; no free text.

### Safety

- **Untrusted.** Cards are written by agents and teammates. The Town:
  - reads only enumerations and bounded integers (`gen.ts`)
  - never renders a card's strings as text, never loads a URL, image or
    script from one
  - falls back to the generated house or look for anything unknown
  - tests this with junk, oversized and hostile cards (`test/gen.test.ts`)
- **Size and rate** are capped by the server, so a card can't bloat the
  log or flood redraws.
- **No authority:** a card changes no permission and no routing; it's a
  look.

## Where Town code may live

- Town is the top-level package `town/` (TypeScript, its own build, tests
  and licence). The app consumes only its built page, copied into
  `apps/macos/Senate/Web/town` by `apps/macos/scripts/sync-town.sh`.
- Town reads cards through the observe API like any other client; nothing
  of Town lives in the CLI, daemon, server or core crates.
- The card above is the only thing the core gains. It's generic, so it
  isn't Town code.
