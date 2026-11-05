# Vault Health Report

Vault Health Report scans your Obsidian vault's frontmatter and shows one report of property drift so you can spot inconsistencies across your notes.

## What it detects

- **Lookalike keys**: Property names that differ by case (`Tags` vs `tags`), word separator (`due-date` vs `due_date` vs `dueDate`), plural form (`category` vs `categories`), configured synonyms (`created` vs `date-created`), or a rare single-character typo (`category` vs `catagory`).
- **Near-duplicate values**: Property values on the same key that differ by case (`Done` vs `done`), separator (`in-progress` vs `in progress`), configured synonyms (`done` vs `complete`), or a rare single-character typo (`pending` vs `pendng`).
- **Mixed value types**: Properties whose values mix two or more non-empty types across notes, such as `list` and `text` on `tags`, or `number` and `text` on `rating`.
- **Mixed date formats**: Date properties where notes mix two or more date formats, such as ISO dates (`2026-11-04`), slash dates (`11/04/2026`), dotted dates (`04.11.2026`), compact dates (`20261104`), or written dates (`Nov 4, 2026`).
- **Rare keys**: Property keys used in at most the configured threshold number of notes (default 3) in vaults with at least 20 notes, excluding keys already grouped under lookalike keys.
- **Property-by-value lookup**: A search box at the bottom of the report that finds every property key holding a given value, with exact or substring ("Contains") matching.

## Opening and using the report

1. Click the stethoscope icon (**Vault Health: Open report**) in the left ribbon, or run **Vault Health Report: Open report** from the command palette.
2. Use the **Scope** dropdown in the report header to scan the whole vault or a single folder.
3. Click any drift group card to expand it and view the notes for each variant. Click any note path to open that note.
4. Click **Copy report as markdown** to copy a markdown summary of all sections to your clipboard.

## Dismissing and restoring groups

- If a reported group is intentional, click **Not drift** on its card. The group is hidden immediately and the dismissal is saved in plugin settings across restarts.
- Check **Show dismissed** in the report header to view dismissed groups again, and click **Restore** on any dimmed card to un-dismiss it.
- You can also reset all dismissals at once using **Clear dismissed groups** in the plugin settings tab.

## Settings

- **Rare key threshold**: Maximum number of notes for a key to be reported as rare (default `3`).
- **Spelling distance**: Toggle typo detection (Damerau-Levenshtein distance 1, minimum 6 characters, rare variant) on or off (default on).
- **Key synonym list**: Editable list of synonym sets for property keys, one set per line, comma-separated.
- **Value synonym list**: Editable list of synonym sets for property values, one set per line, comma-separated.
- **Ignored keys**: Frontmatter keys to skip during scanning (default `position`).
- **Excluded folders**: Folder paths to exclude from scanning.
- **Clear dismissed groups**: Restores all previously dismissed drift groups.

## Want help cleaning up?

The report shows where your properties have drifted. If you'd like a clear target to clean up toward, the [Vault Cleanup Playbook](https://atlascreative0.gumroad.com/l/YOUR-PLAYBOOK) from Atlas Creative is a guide to choosing a consistent property scheme, with templates that keep drift from coming back.

If you'd rather hand it off, Atlas Creative also offers a [done-for-you vault cleanup](https://atlascreative0.gumroad.com/l/YOUR-CLEANUP). Share the output of **Copy report as markdown** and the work is scoped up front, before anything changes.

## Read-only and private

- **Strictly read-only**: Version 1 never writes to, modifies, renames, or deletes any note in your vault.
- **Frontmatter only**: The plugin reads frontmatter solely through Obsidian's metadata cache (`app.metadataCache`). It does not read note body text or inline Dataview fields.
- **No network requests**: The plugin runs entirely offline with zero network calls and zero telemetry.

## Manual installation

1. Build or download `main.js`, `manifest.json`, and `styles.css`.
2. In your vault, create the folder `.obsidian/plugins/vault-health-report/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/vault-health-report/`.
4. Reload Obsidian and enable **Vault Health Report** under **Settings > Community plugins**.

## License

0BSD
