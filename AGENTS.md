# paseo-project-groups

Paseo plugin: the "Project groups" sidebar view. `CLAUDE.md` is a symlink to this file.
If `CLAUDE.local.md` exists and was not loaded automatically, read it first: it holds the
contributor's own setup and is never committed.

## Workflow

- Open an issue before a PR. One issue per PR, small diffs, no new settings unless the issue asks.
- Every bug fix comes with a test that fails without the fix.
- New UI strings: add them to en, ko and zh-CN in `client/messages.ts`.
- A new display option must work in both By project and By relation (`test/view-parity.test.cjs`).

## Commands

- `npm test` (node:test, `test/*.test.cjs`) and `npm run typecheck`. Both must pass; CI runs both
  on every pull request.
- `paseo plugin install <this folder>`, then `paseo plugin reload project-groups` after edits.
- `paseo plugin remove` deletes `~/.paseo/plugin-settings/project-groups/`. Back it up first.

## Code map

- `client/view.tsx`: sidebar view, sections, folding, By project / By relation modes.
- `client/rows.tsx`: group, project and workspace rows, folded status badge, active-workspace fill.
- `client/model.ts`: pure helpers (groups, moves, sub-projects, sorting).
- `client/drag.tsx` + `client/hit.ts`: drag and drop and drop targets.
- `client/relationship-model.ts`, `client/relationships.tsx`, `client/relationship-rail.tsx`:
  parent and child agents, By relation rows and lines.
- `client/display-menu.tsx`, `client/look.tsx`: display options. `client/settings-screen.tsx`:
  appearance settings page.
- `client/dialogs.tsx`, `client/decor.tsx`, `client/labels.tsx`: menus, colors and icons, labels.
- `client/messages.ts` + `client/i18n.ts`: translations.
- `shared/settings.ts`: daemon-side settings (groups, decorations). Appearance and folding are per
  device. `server/`: daemon-side actions (project icons, remove project, workspace actions).
- Plugin API types: `node_modules/@getpaseo/plugin/dist/client/contracts.d.ts`
  (`PluginSidebarViewProps`) and `client-state.d.ts` (`useWorkspaces`, `useWorkspace`).

## Tests

- Load code through `test/helpers/loader.cjs`. `createLoader(overrides)` loads `client/`,
  `shared/` and `server/` for real and fakes only outside packages (`react-native`,
  `@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`, `@tanstack/react-query`).
- Never fake a plugin module just to make a file load. Fake one only when the test needs
  controlled behaviour, and say why in a comment.
- `makeHarness` mounts the whole sidebar (`GroupsView`) with fixture workspaces and agents.
- The `ui.Modal` fake drops plugin React context like the app's sheet: read context outside it.
- A known bug without a fix yet: write the real assertion and mark it `{ todo: "<reason> (#issue)" }`.
  Remove the `todo` in the PR that fixes it.
