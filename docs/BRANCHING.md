# Branching model

This fork keeps two long-lived branches with different jobs:

- **`master`** is a pure mirror of upstream (`Serhii-Leniv/claude-router`), byte-identical to upstream's own tree. Nothing is committed here directly - not own code, not own CI, not centrally managed repository infrastructure; it only ever moves forward by pulling upstream in. No pull request is ever opened back against upstream from this fork.
- **`smoo/main`** is where all of this fork's own work happens: patches, model/pricing table updates, release tags, and this fork's own CI config changes. It is the default branch, so PRs and the repository UI land here.

## Centrally managed files

`.github/dependabot.yml` is written by a central security-baseline script through GitHub's contents API with no `branch` parameter, so it always lands on the **default branch**, which is `smoo/main`. Dependabot itself only reads the config from the default branch, so that is also the only copy that does anything. A copy on `master` is read by nobody and only makes the next upstream merge conflict on a line upstream never shipped - two such own commits (`5ebce7b`, `202b40e`) were removed from `master` on 2026-10-10 for exactly that reason, and `master` was reset to upstream's tip.

The same holds for anything else that script manages: it belongs on `smoo/main`, never on `master`.

## Pulling upstream in

When `master` has moved (a sync from upstream), bring those commits into `smoo/main` with a **merge**, not a rebase:

```
git checkout smoo/main
git merge master
```

A rebase would rewrite commits on `smoo/main` that a published tag or release tarball may already point at - once a commit on `smoo/main` has been tagged, its hash has to stay stable. A merge keeps that history intact and only adds upstream's new commits on top.

## Releases

Tags are set on `smoo/main`, using the `<upstream-version>-smoo.<n>` scheme (e.g. `0.4.0-smoo.1`). `.github/workflows/publish.yml`'s "Tag must be on smoo/main" step enforces that a tag's commit is reachable from `origin/smoo/main` before anything downstream of it runs.

## Upstream sync cadence

The pull from `master` into `smoo/main` is manual, on demand - whenever something from upstream is actually wanted, not on a schedule and not through any Dependabot-adjacent automation. A scheduled job was rejected on two grounds: it produces merge PRs that nobody reads, and an unattended merge into a branch carrying release tags can land a conflict unattended, which is the one failure mode this branch layout exists to avoid.

Mirror drift between `master` and upstream is the accepted cost of staying manual, and it is visible at any time by comparing `master` against `upstream/master`. When the merge above conflicts, it is resolved by hand in the same session that chose to pull - there is no unattended path left to leave a conflict behind on.

A new upstream base resets the `-smoo.<n>` counter against that new version rather than continuing the old one: merging upstream `0.5.0` into `smoo/main` makes the next own release `0.5.0-smoo.1`, not `0.4.0-smoo.2`.
