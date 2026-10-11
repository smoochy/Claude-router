# Releasing

This fork does not publish to npm - `@sheruq/claude-router` on the registry belongs to upstream, not to this fork. A release here is a GitHub Release with a tarball attached, built by `npm pack` and installed with `npm install -g <release-asset-url>`.

Every release must be reproducible from a tag on `smoo/main`. 0.3.2 and 0.3.3 (upstream's own releases, before this fork existed) were published by hand from a side branch and could not be reproduced; the `publish` workflow refuses a tag that is not on `smoo/main` or does not match `package.json`.

Tags use the upstream base plus a `-smoo.<n>` prerelease suffix, e.g. `0.4.0-smoo.1` for the first fork-only release on top of upstream's `0.4.0`, `0.4.0-smoo.2` for the next, and so on. A prerelease sorts below the plain `0.4.0` by semver - accepted, since installs come from a tarball URL, never from an npm range resolution.

## Checklist

1. `git checkout smoo/main && git pull` — release only from an up-to-date `smoo/main`.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z-smoo.n] — YYYY-MM-DD` and open a fresh empty `## [Unreleased]` above it. Pre-1.0: minor = features, patch = fixes.
3. `npm version x.y.z-smoo.n --no-git-tag-version` (updates `package.json` and the lockfile).
4. `npm test`, then `npm pack --dry-run` and compare the file list with the previous release.
5. Open a PR titled `chore(release): x.y.z-smoo.n` with those two changes; squash-merge it.
6. Tag the merge commit and push the tag:
   ```sh
   git checkout smoo/main && git pull
   git tag -a vx.y.z-smoo.n -m "x.y.z-smoo.n"
   git push origin vx.y.z-smoo.n
   ```
7. The `publish` workflow tests, verifies tag ⇔ version ⇔ `smoo/main`, packs the tarball, and creates the GitHub release with that tarball attached.
8. Confirm: the release page has the `.tgz` asset, and `npm install -g <that asset's URL>` installs it.

## Pricing snapshot

Prices come from `src/pricing-snapshot.json`, a trimmed copy of the published model list. The `publish` workflow runs `npm run pricing:refresh` before testing and packing, so a tarball carries the list as of the release; if the list cannot be fetched or fails validation the build fails rather than shipping a stale table. Run the same command locally to refresh the committed copy.

## Mac install

Installing the release tarball on the Mac is two manual commands, run per release: `npm install -g <url of the .tgz release asset>`, then `claude-router install` - the second command is still required because it is what writes `~/.claude-router/config.json`, applies `CLAUDE_CODE_PROFILE` (`src/proxy/cli-config.ts:366-370`) and wires the statusline.

This stays a manual step per release rather than something automated: the version is a semver prerelease (`0.4.0-smoo.1`) that deliberately sorts below the plain `0.4.0`, so it is not resolvable through an npm range and no range-based auto-update is possible anyway.

Whether the Mac also has the home-directory `file:` dependency arrangement documented below for Windows is unverified - do not assume the plain `npm install -g` path above is incomplete there until that is checked.

## Windows install

`npm install -g <release-asset-url>` as documented for the Mac does not work on this machine: this npm configuration refuses remote tarball specifiers outright (`EALLOWREMOTE`, "Fetching packages of type \"remote\" have been disabled"), failing before it fetches anything. Download the asset first, then install from the local file:

```sh
gh release download vx.y.z-smoo.n -D <dir>
npm install -g <dir>/claude-router-x.y.z-smoo.n.tgz
```

On this machine the global install above is also not what runs. `~/package.json` carries a `file:` dependency on `@sheruq/claude-router` pointing at `.claude-router/dist/claude-router-<version>.tgz` (releases up to 0.4.0-smoo.2 carry the old `sheruq-claude-router-<version>.tgz` name), and `~/node_modules/.bin/claude-router` shadows the global binary on `PATH`. `npm install -g` therefore updates a copy nothing executes. To actually upgrade:

1. Copy the downloaded tarball into `~/.claude-router/dist/`.
2. Point the `@sheruq/claude-router` dependency in `~/package.json` at that file.
3. Run `npm install` from `~` (not `-g`).
4. `claude-router --version` now reports the new version.

Installing is not activating: the running proxy keeps executing the code it started with, so `curl /health` keeps reporting the old `version` until the process is restarted.
