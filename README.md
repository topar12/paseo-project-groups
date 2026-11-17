# Project groups for Paseo

Sort Paseo sidebar projects into groups you can drag, fold and color.

![Project groups](assets/thumbnail.png)

## Install

Find Project groups on the Plugins page in Paseo, or run:

```bash
paseo plugin add topar12/project-groups
```

## Turn it on

Installing does not change the sidebar. Open **Settings → Sidebar** and set **View** to **Project groups**.

![Settings → Sidebar → View → Project groups](assets/setup.png)

## What you can do

- Make groups with **New group** at the top of the sidebar, then drag projects into them.
- Drag group headers to reorder groups. Fold the ones you aren't using.
- Give groups and projects a color and an icon or emoji. Workspaces get a color.
- Use the ⋯ menus to move, rename, pin, archive or remove things.
- Change text size, row height, space between groups and indentation per device.
- Read the plugin in English, Korean or Simplified Chinese.

On a phone, long-press a row before dragging.

## Requirements

Paseo 0.16 or later on both the daemon and the app, with plugins enabled. Sidebar views arrived in 0.16, so older apps keep the default sidebar.

## Data

Groups, colors and icons are saved in the plugin's settings on the daemon, so every connected app sees the same groups. Appearance and folding are saved per device. Removing a project runs `paseo project delete` on the daemon's machine, since the plugin API has no call for it. The plugin makes no network requests.

Uninstalling the plugin deletes the saved groups. To get a new version, use `paseo plugin update project-groups` instead.

## Development

```bash
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin reload project-groups
```

## License

MIT
