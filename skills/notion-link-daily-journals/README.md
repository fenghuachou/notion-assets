# Notion Daily Journal Linker Skill

A shareable Codex skill for linking records from Notion child databases to matching daily journal pages.

It finds records whose daily-journal relation is empty, derives each record's date in a configured timezone, looks up the daily journal page with the same date, and writes a single relation back to the record.

## What It Updates

Only the configured relation property is updated. Existing relations are not overwritten, daily journal pages are not created, and unrelated fields are left untouched.

## Requirements

- Node.js 18+
- Notion CLI `ntn`
- Notion CLI authentication with access to the configured data sources

Check auth:

```bash
ntn doctor
```

If your machine uses file-based `ntn` auth:

```bash
NOTION_KEYRING=0 ntn doctor
```

## Install

Copy this folder into your skills directory, or install it from GitHub with your preferred skill/plugin manager.

Manual example:

```bash
git clone https://github.com/fenghuachou/notion-assets.git
cp -R notion-assets/skills/notion-link-daily-journals ~/.codex/skills/
```

## Configure

Copy the example config:

```bash
cp examples/config.example.json config.local.json
```

Edit `config.local.json` with your Notion data source IDs and property names. Do not commit local configs containing private Notion IDs.

## Run

Dry run:

```bash
node scripts/link_daily_journals.js --config config.local.json --days 7 --dry-run
```

Write changes:

```bash
node scripts/link_daily_journals.js --config config.local.json --days 7
```

Exact window:

```bash
node scripts/link_daily_journals.js --config config.local.json --start 2026-05-17 --end 2026-05-23
```

JSON report:

```bash
node scripts/link_daily_journals.js --config config.local.json --days 7 --json
```

## Matching Rules

1. Derive the record date using its configured date rule.
2. Convert timestamps to the configured timezone before taking the date.
3. Find daily journal pages where the configured daily journal date property equals the record date.
4. Choose the earliest-created daily journal page if multiple candidates exist.
5. Skip records with no matching daily journal page.

## License

MIT