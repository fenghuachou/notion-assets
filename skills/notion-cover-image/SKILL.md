---
name: notion-cover-image
description: Generate deterministic Notion cover images and set them as page covers with the Notion CLI `ntn`. Use when a user asks to create, refresh, upload, or batch-update Notion page/database cover images, especially date-based diary or journal covers with monthly background colors.
---

# Notion Cover Image

## Overview

Use this skill to generate reproducible Notion cover image URLs and set them as page covers. It is designed for database pages whose cover text is derived from a date property, such as daily journals.

The default generator uses `placehold.co` URLs. This is not AI image generation; it is deterministic template rendering, which makes it stable for scheduled automations.

## Safety Rules

- Run a dry run before writing:

```bash
node scripts/notion_cover_image.js --config examples/config.example.json --dry-run --json
```

- Check Notion CLI authentication before writes:

```bash
ntn doctor
```

- Only update page covers unless the user explicitly asks for title or content changes.
- Do not create or delete Notion pages.
- Use the page date property as the source of truth for cover text.
- Report skipped pages with missing or invalid dates.
- If the local `ntn` install uses file-based auth, prefix commands with `NOTION_KEYRING=0`.

## Configuration

Copy `examples/config.example.json` to a private config such as `config.local.json`.

Required fields:

- `dataSourceId`: Notion data source ID.
- `dateProperty`: date property used for cover text.

Useful optional fields:

- `titleProperty`: title property for readable reports.
- `labelPrefix`: text before the date, default `DIARY`.
- `timezone`: timezone for datetime values, default `Asia/Shanghai`.
- `cover.monthlyBackgroundColors`: one color per month. July can be `0b2f28` for deep ink green.

## Usage

Dry run all pages:

```bash
node scripts/notion_cover_image.js --config config.local.json --dry-run --json
```

Update all existing pages:

```bash
node scripts/notion_cover_image.js --config config.local.json --json
```

Update an exact date window:

```bash
node scripts/notion_cover_image.js --config config.local.json --from 2026-04-01 --to 2026-04-30 --json
```

Update a single page by ID:

```bash
node scripts/notion_cover_image.js --config config.local.json --page-id <page-id> --date 2026-05-26 --json
```

## Workflow

1. Read the config and validate Notion data source settings.
2. Query pages from the data source, or use a provided `--page-id`.
3. Derive a date from the configured date property or the explicit `--date`.
4. Build a `2048 x 1152` cover URL with the configured monthly background color.
5. Patch the Notion page `cover` to that external image URL.
6. Return a compact JSON report with updated, skipped, failed, and per-month counts.

## Notes

- External cover URLs are preferred because they are reliable in headless automations.
- The image URL encodes the date and colors, so the same config and date always produce the same cover.
- If the user needs private binary file uploads instead of external URLs, verify Notion file upload cover support first; some environments accept the upload but return `cover: null` when applying it as a page cover.
