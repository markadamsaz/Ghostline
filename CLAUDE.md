# Ghostline

## Publishing: after every change, without asking

The owner wants every change live right away. After a change is made and the simulation test passes:

1. Commit on the working branch and push it.
2. Push the same commit to `main` (fast-forward only: check `git merge-base --is-ancestor origin/main HEAD` first; never force-push).
3. Publish the site. GitHub Pages serves the `gh-pages` branch, which is a copy of `public/` (plus `.nojekyll`). Check it out in a worktree from `origin/gh-pages`, copy `public/.` over it, commit "Publish: ...", push `gh-pages`, then remove the worktree.

Whenever `style.css` or `app.js` change, bump their `?v=` numbers in `public/index.html` so phones load the new version.

## Running the tests

`test/sim.mjs` needs `playwright-core` and `ws` in `node_modules` (gitignored). In the cloud container:

```
ln -sfn /opt/node-tools/node_modules/playwright-core node_modules/playwright-core
npm install --no-save
CHROME=/opt/pw-browsers/chromium CHROME_ARGS="--no-sandbox" node test/sim.mjs
```
