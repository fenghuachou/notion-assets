#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function usage() {
  console.log(`Usage:
  link_daily_journals.js --config config.local.json [--days 7] [--dry-run] [--json]
  link_daily_journals.js --config config.local.json --start YYYY-MM-DD --end YYYY-MM-DD [--dry-run]

Options:
  --config PATH   Required unless NOTION_DAILY_JOURNAL_CONFIG is set
  --days N        Relative window ending today in configured timezone (default: 7)
  --start DATE    Exact start date, YYYY-MM-DD
  --end DATE      Exact end date, YYYY-MM-DD
  --dry-run       Report changes without writing
  --json          Print JSON report
`);
}

function parseArgs(argv) {
  const opts = {
    days: 7,
    dryRun: false,
    json: false,
    config: process.env.NOTION_DAILY_JOURNAL_CONFIG || "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--config") {
      opts.config = argv[++i];
    } else if (arg === "--days") {
      opts.days = Number(argv[++i]);
    } else if (arg === "--start") {
      opts.start = argv[++i];
    } else if (arg === "--end") {
      opts.end = argv[++i];
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!opts.config) throw new Error("Missing --config PATH or NOTION_DAILY_JOURNAL_CONFIG.");
  if ((opts.start && !opts.end) || (!opts.start && opts.end)) {
    throw new Error("Pass both --start and --end, or neither.");
  }
  if (!Number.isInteger(opts.days) || opts.days < 1) {
    throw new Error("--days must be a positive integer.");
  }
  return opts;
}

function loadConfig(configPath) {
  const fullPath = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (!config.dailyJournal?.dataSourceId) throw new Error("Config missing dailyJournal.dataSourceId.");
  if (!config.dailyJournal?.dateProperty) throw new Error("Config missing dailyJournal.dateProperty.");
  if (!Array.isArray(config.databases) || config.databases.length === 0) {
    throw new Error("Config must include at least one child database.");
  }
  for (const db of config.databases) {
    if (!db.name || !db.dataSourceId || !db.relationProperty || !db.date?.mode) {
      throw new Error(`Invalid database config: ${JSON.stringify(db)}`);
    }
  }
  config.timezone ||= "Asia/Shanghai";
  return config;
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD.`);
}

function runNtn(args, input) {
  const result = spawnSync("ntn", args, {
    input,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 80 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ntn ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function queryAll(dataSourceId, filter) {
  const results = [];
  let cursor = "";
  for (;;) {
    const args = [
      "datasources",
      "query",
      dataSourceId,
      "--limit",
      "100",
      "--filter",
      JSON.stringify(filter),
      "--json",
    ];
    if (cursor) args.splice(5, 0, "--start-cursor", cursor);
    const data = JSON.parse(runNtn(args));
    results.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return results;
}

function querySafe(dataSourceId, filter, failures, db, stage) {
  try {
    return queryAll(dataSourceId, filter);
  } catch (error) {
    failures.push({ db, stage, error: error.message.slice(0, 700) });
    return [];
  }
}

function patchRelation(pageId, relationName, dailyJournalId) {
  const body = JSON.stringify({
    properties: {
      [relationName]: {
        relation: [{ id: dailyJournalId }],
      },
    },
  });
  runNtn(["api", `v1/pages/${pageId}`, "-X", "PATCH"], body);
}

function localDate(iso, timezone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function today(timezone) {
  return localDate(new Date().toISOString(), timezone);
}

function addDays(dateString, delta, timezone) {
  const date = new Date(`${dateString}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return localDate(date.toISOString(), timezone);
}

function dateRange(start, end, timezone) {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1, timezone)) {
    dates.push(date);
  }
  return dates;
}

function notionDateToLocalDate(prop, timezone) {
  if (!prop?.date?.start) return null;
  const value = prop.date.start;
  if (!value.includes("T")) return value.slice(0, 10);
  return localDate(value, timezone);
}

function propText(prop) {
  if (!prop) return "";
  if (prop.title) return prop.title.map((item) => item.plain_text || "").join("");
  if (prop.rich_text) return prop.rich_text.map((item) => item.plain_text || "").join("");
  return "";
}

function titleOf(page, props = []) {
  for (const propName of props) {
    const value = propText(page.properties?.[propName]);
    if (value) return value.slice(0, 80);
  }
  return page.id;
}

function dateSpecProperties(dateSpec) {
  if (dateSpec.property) return [dateSpec.property];
  if (Array.isArray(dateSpec.properties)) return dateSpec.properties;
  return [];
}

function recordDate(page, dateSpec, timezone) {
  for (const propName of dateSpecProperties(dateSpec)) {
    const prop = page.properties?.[propName];
    if (!prop) continue;
    if (prop.type === "date") {
      const date = notionDateToLocalDate(prop, timezone);
      if (date) return { date, source: propName };
    }
    if (prop.type === "created_time") {
      const date = localDate(prop.created_time, timezone);
      if (date) return { date, source: propName };
    }
  }
  return { date: null, source: dateSpecProperties(dateSpec).join(" / ") };
}

function relationIsEmpty(page, relationName) {
  return (page.properties?.[relationName]?.relation || []).length === 0;
}

function relationEmptyFilter(db) {
  return { property: db.relationProperty, relation: { is_empty: true } };
}

function dateRangeFilters(propName, start, end) {
  return [
    { property: propName, date: { on_or_after: start } },
    { property: propName, date: { on_or_before: end } },
  ];
}

function createdRangeFilters(propName, start, end, timezone) {
  const broadStart = addDays(start, -1, timezone);
  const broadEnd = addDays(end, 1, timezone);
  return [
    { property: propName, created_time: { on_or_after: broadStart } },
    { property: propName, created_time: { on_or_before: broadEnd } },
  ];
}

function filtersFor(db, start, end, timezone) {
  const relation = relationEmptyFilter(db);
  const mode = db.date.mode;
  if (mode === "date") {
    return [{ and: [relation, ...dateRangeFilters(db.date.property, start, end)] }];
  }
  if (mode === "created_time") {
    return [{ and: [relation, ...createdRangeFilters(db.date.property, start, end, timezone)] }];
  }
  if (mode === "date_fallback") {
    const [primary, fallback] = db.date.properties;
    return [
      { and: [relation, ...dateRangeFilters(primary, start, end)] },
      { and: [relation, { property: primary, date: { is_empty: true } }, ...dateRangeFilters(fallback, start, end)] },
    ];
  }
  if (mode === "date_created_time_fallback") {
    const [primary, fallback] = db.date.properties;
    return [
      { and: [relation, ...dateRangeFilters(primary, start, end)] },
      {
        and: [
          relation,
          { property: primary, date: { is_empty: true } },
          ...createdRangeFilters(fallback, start, end, timezone),
        ],
      },
      { and: [relation, ...createdRangeFilters(fallback, start, end, timezone)] },
    ];
  }
  throw new Error(`Unsupported date mode: ${mode}`);
}

function inWindow(date, start, end) {
  return Boolean(date && date >= start && date <= end);
}

function dailyJournalMap(config, dates) {
  const byDate = new Map();
  const counts = {};
  for (const date of dates) {
    const pages = queryAll(config.dailyJournal.dataSourceId, {
      property: config.dailyJournal.dateProperty,
      date: { equals: date },
    }).sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
    byDate.set(date, pages);
    counts[date] = pages.length;
  }
  return { byDate, counts };
}

function linkDailyJournals(config, options) {
  if (!options.start) {
    options.end = today(config.timezone);
    options.start = addDays(options.end, 1 - options.days, config.timezone);
  }
  validateDate(options.start, "--start");
  validateDate(options.end, "--end");
  if (options.start > options.end) throw new Error("--start must be on or before --end.");

  const dates = dateRange(options.start, options.end, config.timezone);
  const journals = dailyJournalMap(config, dates);
  const details = { updated: [], noDiary: [], multi: [], failures: [], skippedNoDate: [] };
  const summary = [];

  for (const db of config.databases) {
    const stats = {
      db: db.name,
      scanned: 0,
      updated: 0,
      skipped: 0,
      noDiary: 0,
      multiMatchChosen: 0,
      noDate: 0,
      failed: 0,
    };

    const pagesById = new Map();
    const failuresBefore = details.failures.length;
    for (const filter of filtersFor(db, options.start, options.end, config.timezone)) {
      for (const page of querySafe(db.dataSourceId, filter, details.failures, db.name, "scan")) {
        pagesById.set(page.id, page);
      }
    }
    stats.failed += details.failures.length - failuresBefore;

    for (const page of pagesById.values()) {
      if (!relationIsEmpty(page, db.relationProperty)) continue;
      const { date, source } = recordDate(page, db.date, config.timezone);
      if (!inWindow(date, options.start, options.end)) continue;
      stats.scanned += 1;

      if (!date) {
        stats.skipped += 1;
        stats.noDate += 1;
        details.skippedNoDate.push({ db: db.name, id: page.id, title: titleOf(page, db.titleProperties), source });
        continue;
      }

      const candidates = journals.byDate.get(date) || [];
      if (candidates.length === 0) {
        stats.skipped += 1;
        stats.noDiary += 1;
        details.noDiary.push({
          db: db.name,
          id: page.id,
          title: titleOf(page, db.titleProperties),
          date,
          tried: `${config.dailyJournal.dateProperty} = ${date}`,
        });
        continue;
      }

      const selected = candidates[0];
      if (candidates.length > 1) {
        stats.multiMatchChosen += 1;
        details.multi.push({
          db: db.name,
          id: page.id,
          title: titleOf(page, db.titleProperties),
          date,
          selected: selected.id,
          selected_created_time: selected.created_time,
          reason: "selected earliest-created daily journal page",
          candidates: candidates.map((candidate) => ({ id: candidate.id, created_time: candidate.created_time })),
        });
      }

      try {
        if (!options.dryRun) patchRelation(page.id, db.relationProperty, selected.id);
        stats.updated += 1;
        details.updated.push({
          db: db.name,
          id: page.id,
          title: titleOf(page, db.titleProperties),
          date,
          dateSource: source,
          diary: selected.id,
          dryRun: options.dryRun,
        });
      } catch (error) {
        stats.skipped += 1;
        stats.failed += 1;
        details.failures.push({
          db: db.name,
          id: page.id,
          title: titleOf(page, db.titleProperties),
          date,
          error: error.message.slice(0, 700),
        });
      }
    }
    summary.push(stats);
  }

  return {
    mode: options.dryRun ? "dry-run" : "write",
    window: { start: options.start, end: options.end, timezone: config.timezone },
    dailyJournalCandidateCounts: journals.counts,
    summary,
    details,
  };
}

function printHuman(report) {
  console.log(`Mode: ${report.mode}`);
  console.log(`Window: ${report.window.start} to ${report.window.end} (${report.window.timezone})`);
  console.log("");
  console.log("| DB | Scanned | Linked | Skipped | No diary | Multi match | Failed |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of report.summary) {
    console.log(
      `| ${row.db} | ${row.scanned} | ${row.updated} | ${row.skipped} | ${row.noDiary} | ${row.multiMatchChosen} | ${row.failed} |`,
    );
  }
  if (report.details.updated.length) {
    console.log("");
    console.log("Updated:");
    for (const item of report.details.updated) {
      console.log(`- ${item.db}: ${item.title} (${item.date}) -> ${item.diary}${item.dryRun ? " [dry-run]" : ""}`);
    }
  }
  if (report.details.noDiary.length) {
    console.log("");
    console.log("No matching diary:");
    for (const item of report.details.noDiary) {
      console.log(`- ${item.db}: ${item.title} (${item.date}); tried ${item.tried}`);
    }
  }
  if (report.details.multi.length) {
    console.log("");
    console.log("Multi-match choices:");
    for (const item of report.details.multi) {
      console.log(`- ${item.db}: ${item.title} (${item.date}) -> ${item.selected}; ${item.reason}`);
    }
  }
  if (report.details.failures.length) {
    console.log("");
    console.log("Failures:");
    for (const item of report.details.failures) {
      console.log(`- ${item.db}${item.id ? ` ${item.id}` : ""}: ${item.error}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.config);
  const report = linkDailyJournals(config, options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}