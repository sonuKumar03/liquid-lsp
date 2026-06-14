# Task: Inspect SpotDraft LiquidJS vs upstream LiquidJS

Repos:

- Fork: SpotDraft/liquidjs
- Upstream: harttle/liquidjs

Goal:
Find whether merging/rebasing upstream helps the computation engine and LSP work.

Run:

```bash
git remote add upstream https://github.com/harttle/liquidjs.git || true
git fetch upstream

BASE=$(git merge-base HEAD upstream/master)

git rev-list --left-right --count upstream/master...HEAD
git diff --stat upstream/master...HEAD

comm -12 \
 <(git diff --name-only $BASE..HEAD | sort) \
 <(git diff --name-only $BASE..upstream/master | sort)

git log --oneline upstream/master..HEAD
git log --oneline HEAD..upstream/master
```
