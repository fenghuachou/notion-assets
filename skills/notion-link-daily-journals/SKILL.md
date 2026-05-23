---
name: notion-link-daily-journals
description: Auto-link records from Notion child databases to matching daily journal pages. Use when a user asks to fill, repair, or audit relation fields such as "📔 关联日记" or "📔 每日日记" by matching each record's local date to a daily journal database using the Notion CLI `ntn`.
---

# Notion Link Daily Journals

## Overview

Use this skill to connect recent records in one or more Notion databases back to daily journal pages by date. Prefer the Notion CLI `ntn` for all reads and writes.

## Safety Rules

- Run a dry run before writing:

```bash
node scripts/link_daily_journals.js --config examples/config.example.json --days 7 --dry-run
```

- Check Notion CLI authentication before writes:

```bash
ntn doctor
```

- Only update the configured relation property.
- Do not overwrite records that already have a relation.
- Do not create daily journal pages.
- Do not modify titles, dates, tags, summaries, or daily journal pages.
- Report unmatched dates, multiple daily journal candidates, and failed records.

## Configuration

Copy `examples/config.example.json` to a private path such as `config.local.json`, then replace placeholders with your Notion data source IDs and property names.

The target daily journal database needs:

- `dataSourceId`
- a date property such as `日期`

Each child database needs:

- `dataSourceId`
- `relationProperty`
- `date` rule
- optional `titleProperties` for readable reports

See `references/schema.md` for the config schema.

## Usage

Dry run:

```bash
node scripts/link_daily_journals.js --config config.local.json --days 7 --dry-run
```

Write changes:

```bash
node scripts/link_daily_journals.js --config config.local.json --days 7
```

Exact date window:

```bash
node scripts/link_daily_journals.js --config config.local.json --start 2026-05-17 --end 2026-05-23 --dry-run
```

Structured output:

```bash
node scripts/link_daily_journals.js --config config.local.json --days 7 --json
```

If your `ntn` install uses file-based auth, prefix commands with `NOTION_KEYRING=0`.

## Matching Rules

1. Determine each record's date in the configured timezone, default `Asia/Shanghai`.
2. Query the daily journal data source by its date property equal to that record date.
3. If one candidate exists, write the relation to that page.
4. If multiple candidates exist, choose the page with the earliest `created_time`.
5. If no candidate exists, skip the record and include the attempted date in the report.

## Implementation Notes

- Date-only Notion values are used as-is.
- Datetime and `created_time` values are converted to the configured timezone before taking the date.
- Fallback date rules are queried in segments and de-duplicated client-side because Notion filters can reject deeply nested fallback logic.
- `created_time` queries use a slightly wider date range and then apply the authoritative local-date window client-side.