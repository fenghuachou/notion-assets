# Notion Cover Image Skill

A shareable Codex skill for generating deterministic Notion cover images and setting them as page covers.

It works well for daily journals, content calendars, and any Notion database where a date property should drive the cover text.

## What It Updates

By default, only the page `cover` is updated. It does not create pages, delete pages, modify page content, or change relations.

## Requirements

- Node.js 18+
- Notion CLI `ntn`
- Notion CLI authentication with access to the target data source and pages

Check auth:

```bash
ntn doctor
```

If your machine uses file-based `ntn` auth:

```bash
NOTION_KEYRING=0 ntn doctor
```

## Install

Copy this folder into your skills directory, or install it from this repository with your preferred skill/plugin manager.

Manual example:

```bash
git clone https://github.com/fenghuachou/notion-assets.git
cp -R notion-assets/skills/notion-cover-image ~/.codex/skills/
```

## Configure

Copy the example config:

```bash
cp examples/config.example.json config.local.json
```

Edit `config.local.json` with your Notion data source ID and property names. Do not commit local configs containing private Notion IDs.

## Run

Dry run:

```bash
node scripts/notion_cover_image.js --config config.local.json --dry-run --json
```

Write changes:

```bash
node scripts/notion_cover_image.js --config config.local.json --json
```

Exact date window:

```bash
node scripts/notion_cover_image.js --config config.local.json --from 2026-04-01 --to 2026-04-30 --json
```

Single page:

```bash
node scripts/notion_cover_image.js --config config.local.json --page-id <page-id> --date 2026-05-26 --json
```

## Cover Design

Default covers use:

- Size: `2048 x 1152`
- Text: `DIARY yyyy.mm.dd`
- Text color: cream `fff3cf`
- Generator: `placehold.co`
- Monthly background colors, including July deep ink green `0b2f28`

## License

MIT
