# Project groups for Paseo

Sort Paseo sidebar projects into groups you can drag, fold and color.

**Languages:** English, Korean (한국어), Simplified Chinese (简体中文)

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
- Put a project under another project from its ⋯ menu (one level deep).
- With several hosts connected, Ungrouped splits by host and grouped projects show a host tag.
- Give groups and projects a color and an icon (any Lucide icon, searchable by name) or emoji. Workspaces get a color.
- Projects use their Paseo image unless you choose a plugin icon or emoji.
- Folded projects and groups show the most urgent workspace status on their icon, and a light fill when they hold the workspace you have open.
- See which agents started which: lines join a parent agent's workspace with its sub-agents' workspaces, and **By relation** shows all agents as a tree. Turn the lines off in the settings if you don't need them.
- Move through the list with the keyboard in the desktop app and browser, including jumps to an agent's parent and siblings.
- Use the ⋯ menus to move, rename, label, pin, archive or remove things, mark a workspace as read or unread, and open a project's settings.
- Change text size, row height, space between groups and indentation per device, and how workspaces are sorted, titled and labeled, like in Paseo's own sidebar.
- Read the plugin in English, Korean or Simplified Chinese.

On a phone or tablet, long-press a name before dragging. A quick swipe scrolls the list.

## Requirements

Paseo 0.16 or later on both the daemon and the app, with plugins enabled. Sidebar views arrived in 0.16, so older apps keep the default sidebar.

## Data

Groups, colors and icons are saved in the plugin's settings on the daemon, so every connected app sees the same groups. Appearance and folding are saved per device. Project icons, label colors and read state go through a local connection to that daemon, and no external service is contacted. Removing a project and checking whether a sub-project's parent still exists also use that connection, because the plugin API has no call for them, and a parent's nesting is cleaned up only when the daemon says the parent is gone. The plugin starts no other programs.

Uninstalling the plugin deletes the saved groups. To get a new version, use `paseo plugin update project-groups` instead.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload project-groups
```

## License

MIT
