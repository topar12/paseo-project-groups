Paseo lists every project in one long column. Once you have a dozen or so, finding one means scrolling. This plugin lets you put projects into groups like Work, Clients or Side projects, and fold the groups you aren't using right now.

## Turn it on after installing

Installing the plugin does not change the sidebar. Paseo only switches sidebar views when you pick one yourself.

1. Open **Settings → Sidebar**.
2. Set **View** to **Project groups**.

The second screenshot shows both steps. To go back, set View to Default view. Your groups stay saved.

## Making groups

Click **New group** at the top of the sidebar and type a name. Then drag projects onto it.

- Drop a project on a group header to add it to the end of that group.
- Drop it between two projects to put it where the blue line shows.
- Drag a group header to move the whole group.
- On a phone, long-press a row before you drag it.
- Projects you haven't sorted yet sit under Ungrouped. New projects land there too.
- Deleting a group leaves its projects alone. They go back to Ungrouped.

The ⋯ button on a project moves it to another group, starts a new workspace, copies its path or removes it. The ⋯ button on a workspace renames, pins, copies the path or branch, or archives it.

## Colors and icons

Click a project's folder icon or a group's palette button. Pick one of 11 colors and one of 36 icons, or type an emoji. For a workspace, use Set color in its ⋯ menu. The color goes on the name and the icon.

Colors and icons only show in this view. Paseo's own project icons don't change.

## Settings

The sliders button next to New group opens the plugin's settings. You can change:

- text size, from 11 to 15 pt
- row height
- space between groups, from none to extra large
- how far projects and workspaces are indented
- whether group names are bold
- which details show: folder icons, status dots, changed-line counts, the Pinned section
- the language: same as the app, English, Korean or Simplified Chinese

Settings are saved per device, so your phone and your computer can look different.

## What it stores

Groups, their order, colors and icons are saved in the plugin's settings on the daemon. Every app connected to that daemon sees the same groups. Which groups are folded is saved per device. The plugin makes no network requests.

Removing a project runs `paseo project delete` on the daemon's machine, because the plugin API has no call for it. Paseo archives the project's workspaces and leaves the project folder on disk. Worktrees that Paseo created for those workspaces can be deleted when they are archived. The confirm dialog tells you this before anything happens.

## Limits

- Don't uninstall the plugin to update it. Uninstalling deletes your groups, colors and icons. Update it from the Plugins page or with `paseo plugin update project-groups`.
- Workspaces can't be dragged, because each one belongs to its project's folder.
- The daemon and the app both need Paseo 0.16 or later. Older apps show the plugin as incompatible and keep the default sidebar.
