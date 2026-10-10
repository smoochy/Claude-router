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
