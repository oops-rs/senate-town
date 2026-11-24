# Spec: `Projects` and `ProjectHistory` (bridge IPC reads)

For the Town's per-project monuments: one plot per project (a git
repository its committees' sessions work in), one monument per release tag,
sized by what went in, plaques from the merges. Spec only; nothing is built.

## What a project is

A project is a **git root** the daemon already records for its sessions
(`Session::git_root`, the same value the stats read groups by,
`stat_sessions.repo`). The daemon never takes a path from a client. A client
names a project by an id from `Projects`. That id is opaque: the first 16 hex
digits of SHA-256 of the canonical root path.

## Requests (`senate_bridge::ipc::Request`)

```rust
/// The projects this machine's sessions have worked in.
Projects {},

/// One project's releases and what is merged since the last one.
ProjectHistory {
    /// An id from `Projects`.
    project: String,
    /// The newest N tags to describe (default 24, at most 200).
    #[serde(default)]
    tags: Option<usize>,
    /// Merge subjects kept per tag (default 8, at most 50).
    #[serde(default)]
    subjects: Option<usize>,
},
```

## Replies

```rust
struct ProjectList { projects: Vec<Project> }
struct Project {
    id: String,                  // opaque, stable while the root's path is
    name: String,                // the root's directory name: "senate"
    committees: Vec<CommitteeId>,// committees whose sessions ran there (for placing the plot)
    last_active: DateTime<Utc>,  // the newest session there
    available: bool,             // the root still exists and is a git work tree
}

struct ProjectHistoryReply {
    project: String,
    name: String,
    head: String,                // the default branch's commit the reply describes
    branch: String,              // that branch: origin/HEAD's target, else main, else master
    tags: Vec<Release>,          // oldest first
    unreleased: Changes,         // last tag (or the root commit)..branch
    computed_at: DateTime<Utc>,
    stale: bool,                 // a cached reply, served because computing again failed or timed out
}
struct Release {
    name: String,                // "v0.12.3"
    commit: String,
    date: DateTime<Utc>,         // the tag's creator date
    changes: Changes,            // previous tag..this tag
}
struct Changes {
    merges: u32,                 // merge commits on the first-parent line
    fixes: u32,                  // of them, merges of a `fix/…` branch
    files: u32, insertions: u32, deletions: u32,  // --shortstat over the range
    subjects: Vec<Merge>,        // the newest `subjects` merges
}
struct Merge { branch: Option<String>, line: String }
// "Merge feat/desk-cli: senate desk — list, …" → branch "feat/desk-cli", line "senate desk — list, …"
```

How big a monument is: the Town's choice, from `merges` and `insertions`.
The daemon only reports what went in.

## How it is computed

Each step runs `git` with arguments only (no shell), `-C <root>`,
`GIT_OPTIONAL_LOCKS=0` (no index lock taken in someone's work tree),
`--no-pager`, at low priority, with 5 s per command and 15 s per reply:

1. Branch: `git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`, else `master`. Head: `git rev-parse <branch>`.
2. Tags: `git for-each-ref --merged <branch> --sort=creatordate --format='%(refname:short)%00%(objectname)%00%(creatordate:iso-strict)' refs/tags`. Keep the newest `tags`.
3. For each tag, and for the last tag..branch:
   - `git log --merges --first-parent --format=%s%x00 <prev>..<tag>`: count the merges, count the `fix/` ones, keep the newest `subjects`.
   - `git diff --shortstat <prev> <tag>`.
4. The first tag's range starts at the root commit. Tags not reachable from the branch are left out.

## Caching

- Key: `(project, head, the sorted tag list's hash)`.
- Stored in the bridge's `state.db` (`project_history(project, key, json, computed_at)`), one row per project.
- A request whose key matches the row is answered from it (a `rev-parse` and a `for-each-ref`, a few ms).
- Otherwise the reply is computed again and the row replaced.
- One computation per project at a time; a second request waits for it.
- On failure or timeout, the last row is returned with `stale: true`.
- Rows of projects no session has used for 90 days are dropped.

## Which roots are allowed

- Only roots in the daemon's own session records (live, paused or in session history), canonicalised (`realpath`), and still a git work tree (`git rev-parse --show-toplevel` equals the root).
- Nothing outside that set, whatever a client sends: the request carries an id, never a path.
- Local IPC only (`bridge.sock`). Not served over HTTP and not forwarded to a parent Senate: other machines' repositories are their own daemon's to describe.

## Cost

- This repository (20 tags, 120 merges): uncached about 0.3–0.5 s, mostly `--shortstat`; cached under 10 ms.
- A large repository (thousands of tags, long history): bounded by `tags` (24 by default). Each range is one `log` and one `diff --shortstat`. Expect a few seconds uncached, once per new tag or head.
- No watch, no polling by the daemon. The app asks when the Town opens, and again when it sees a merge into a project's branch, or at most every 10 minutes.

## Errors

- `NotFound`: unknown id.
- `Gone`: the root is no longer a git work tree.
- `Unavailable`: git missing or timed out with nothing cached.

## Not in this read

- The tests counter: nobody records test runs yet; a later `TestRun` record would.
- The building style per project: an app setting, keyed by project id.
