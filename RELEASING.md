# Releasing

This fork ships as `@smoochy/claude-router` on npm and, in addition, as a tarball attached to the GitHub Release (decision 4419, which supersedes the tarball-only decision 4229: npm is added, the tarball stays). Both come from one tag-triggered `publish` workflow; releases are always cut from `smoo/main`, never from `master` (the pure upstream mirror).

Every release must be reproducible from a tag on `smoo/main`. 0.3.2 and 0.3.3 (upstream's own releases, before this fork existed) were published by hand from a side branch and could not be reproduced; the `publish` workflow refuses a tag that is not on `smoo/main` or does not match `package.json`.

Tags use the upstream base plus a `-smoo.<n>` prerelease suffix, e.g. `0.4.0-smoo.1` for the first fork-only release on top of upstream's `0.4.0`, `0.4.0-smoo.2` for the next, and so on. A prerelease sorts below the plain `0.4.0` by semver, which is why every `-smoo.n` is pointed at `latest` explicitly (below).

## Checklist

1. `git checkout smoo/main && git pull` - release only from an up-to-date `smoo/main`.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z-smoo.n] - YYYY-MM-DD` and open a fresh empty `## [Unreleased]` above it. Pre-1.0: minor = features, patch = fixes.
3. `npm version x.y.z-smoo.n --no-git-tag-version` (updates `package.json` and the lockfile), then set the same `version` in `plugin/.claude-plugin/plugin.json` (`plugin.test.ts` fails otherwise).
4. `npm test`, then `npm pack --dry-run` and compare the file list with the previous release.
5. Open a PR titled `chore(release): x.y.z-smoo.n` with those two changes. The security gate (appsec + security-review) runs on it as a required check; it recognises a release PR by the `version` in `package.json` rising against the base branch, not by the head branch name, so the branch can be called anything. Fix its findings before merging. Merge with a merge commit.
6. Tag the merge commit and push the tag:
   ```sh
   git checkout smoo/main && git pull
   git tag -a vx.y.z-smoo.n -m "x.y.z-smoo.n"
   git push origin vx.y.z-smoo.n
   ```
7. The `publish` workflow then runs, in order: tag equals `package.json`, tag reachable from `smoo/main`, `pricing:refresh`, `npm test`, `npm pack`, `npm publish --access public --provenance --tag latest`, GitHub Release with the tarball.
8. Confirm: `npm view @smoochy/claude-router dist-tags` shows the new version on `latest`, and the release page has the `.tgz` asset.

## Re-running a tag

A failed run is healed by re-running the workflow on the same tag. `npm publish` is skipped when the version already exists on the registry (its dist-tag is then not touched; move it by hand with `npm dist-tag add` after `npm login`), and an existing GitHub Release gets the tarball replaced with `gh release upload --clobber` instead of failing on `gh release create`.

## npm publishing

Publishing uses npm trusted publishing (OIDC, no token): the trusted publisher is registered for the `smoochy/Claude-router` repository and the exact workflow filename `publish.yml`, with "Allow npm publish" set (otherwise CI only stages the version). The job needs `id-token: write` and a GitHub-hosted runner. Renaming the workflow file breaks the publisher.

The trusted publisher expires without one successful publish within 2 days of registration. Nothing is built for this: the sync-PR cadence keeps releases flowing, and an expired publisher is fixed by re-registering it on npmjs.com.

Dist-tags: every `-smoo.n` is published straight to `latest` with `npm publish --tag latest`. A prerelease needs an explicit `--tag`, and trusted publishing authorizes only `npm publish`: a separate `npm dist-tag add` in CI fails with E401, so no second pointer is set. The former `smoo` dist-tag stays where it is (`0.4.0-smoo.5`) and is no longer moved. `latest` is a mutable pointer like an image tag. The immutable pin is the exact version (`@smoochy/claude-router@0.4.0-smoo.n`, which npm never lets anyone overwrite) plus the sha512 `dist.integrity` the lockfile pins; npm has no `@sha256:` specifier.

## Install paths

- npm: `npm install -g @smoochy/claude-router` (latest) or `@smoochy/claude-router@0.4.0-smoo.n` (pinned).
- Tarball: the `.tgz` asset on the GitHub Release, see Mac and Windows below. The Windows upgrade path needs it, which is why it stays.

## Pricing snapshot

Prices come from `src/pricing-snapshot.json`, a trimmed copy of the published model list. The `publish` workflow runs `npm run pricing:refresh` before testing and packing, so a tarball carries the list as of the release; if the list cannot be fetched or fails validation the build fails rather than shipping a stale table. Run the same command locally to refresh the committed copy.

## Mac install

Installing the release is `npm install -g @smoochy/claude-router` (or the tarball asset URL), then `claude-router install` - the second command is still required because it is what writes `~/.claude-router/config.json`, applies `CLAUDE_CODE_PROFILE` (`src/proxy/cli-config.ts:366-370`) and wires the statusline.

This stays a manual step per release rather than something automated.

The Mac does not have the home-directory `file:` dependency arrangement documented below for Windows (checked 2026-10-18 on 0.4.0-smoo.6): there is no `~/package.json` and no `~/node_modules/.bin/claude-router`, `claude-router` resolves to the global `/opt/homebrew/bin/claude-router`, and `claude-router --version` matches `npm ls -g`. The plain `npm install -g` path above is complete there.

## Windows install

`npm install -g <release-asset-url>` does not work on this machine: this npm configuration refuses remote tarball specifiers outright (`EALLOWREMOTE`, "Fetching packages of type \"remote\" have been disabled"), failing before it fetches anything. Download the asset first, then install from the local file:

```sh
gh release download vx.y.z-smoo.n -D <dir>
npm install -g <dir>/claude-router-x.y.z-smoo.n.tgz
```

On this machine the global install above is also not what runs. `~/package.json` carries a `file:` dependency on `@sheruq/claude-router` (renamed to `@smoochy/claude-router` from the first release after the npm switch; update the key when upgrading) pointing at `.claude-router/dist/claude-router-<version>.tgz` (releases up to 0.4.0-smoo.2 carry the old `sheruq-claude-router-<version>.tgz` name), and `~/node_modules/.bin/claude-router` shadows the global binary on `PATH`. `npm install -g` therefore updates a copy nothing executes. To actually upgrade:

1. Copy the downloaded tarball into `~/.claude-router/dist/`.
2. Point the `@smoochy/claude-router` dependency in `~/package.json` at that file (remove the old `@sheruq/claude-router` key).
3. Run `npm install` from `~` (not `-g`).
4. `claude-router --version` now reports the new version.

Installing is not activating: the running proxy keeps executing the code it started with, so `curl /health` keeps reporting the old `version` until the process is restarted.
