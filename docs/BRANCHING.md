# Branching model

This fork keeps two long-lived branches with different jobs:

- **`master`** is a pure mirror of upstream (`Serhii-Leniv/claude-router`). Nothing is committed here directly; it only ever moves forward by pulling upstream in. No pull request is ever opened back against upstream from this fork.
- **`smoo/main`** is where all of this fork's own work happens: patches, model/pricing table updates, release tags, and this fork's own CI config changes. It is the default branch, so PRs and the repository UI land here.

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
