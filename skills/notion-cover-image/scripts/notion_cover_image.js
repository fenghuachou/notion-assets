#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_COVER = {
  width: 2048,
  height: 1152,
  textColor: "fff3cf",
  font: "playfair-display",
  monthlyBackgroundColors: {
    "01": "243044",
    "02": "4a2138",
    "03": "31523b",
    "04": "5f6f52",
    "05": "681321",
    "06": "25345d",
    "07": "0b2f28",
    "08": "6b402c",
    "09": "1d4e57",
    "10": "3b2447",
    "11": "7a3a2c",
    "12": "152238",
  },
};

function parseArgs(argv) {
  const args = {
    config: null,
    dryRun: false,
    json: false,
    from: null,
    to: null,
    pageId: null,
    date: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--config") {
      args.config = argv[++index];
    } else if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--from") {
      args.from = argv[++index];
    } else if (value === "--to") {
      args.to = argv[++index];
    } else if (value === "--page-id") {
      args.pageId = normalizePageId(argv[++index]);
    } else if (value === "--date") {
      args.date = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.config) throw new Error("Missing required --config path.");
  return args;
}

function loadConfig(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!config.dataSourceId && !config.pageId) {
    throw new Error("Config must include dataSourceId for batch mode.");
  }
  if (!config.dateProperty && !config.pageId) {
    throw new Error("Config must include dateProperty for batch mode.");
  }
  return {
    timezone: config.timezone || DEFAULT_TIMEZONE,
    dataSourceId: config.dataSourceId,
    dateProperty: config.dateProperty,
    titleProperty: config.titleProperty || "Name",
    labelPrefix: config.labelPrefix || "DIARY",
    cover: {
      ...DEFAULT_COVER,
      ...(config.cover || {}),
      monthlyBackgroundColors: {
        ...DEFAULT_COVER.monthlyBackgroundColors,
        ...(config.cover?.monthlyBackgroundColors || {}),
      },
    },
  };
}

function runNtn(args, input) {
  const result = spawnSync("ntn", args, {
    input,
    encoding: "utf8",
    env: { ...process.env, NOTION_KEYRING: process.env.NOTION_KEYRING || "0" },
    maxBuffer: 80 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ntn ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function queryAll(dataSourceId) {
  const pages = [];
  let cursor = "";
  for (;;) {
    const args = ["datasources", "query", dataSourceId, "--limit", "100", "--json"];
    if (cursor) args.splice(5, 0, "--start-cursor", cursor);
    const data = JSON.parse(runNtn(args));
    pages.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return pages;
}

function fetchPage(pageId) {
  return JSON.parse(runNtn(["api", `/v1/pages/${pageId}`]));
}

function patchCover(pageId, coverUrl) {
  const body = JSON.stringify({
    cover: {
      type: "external",
      external: { url: coverUrl },
    },
  });
  return JSON.parse(runNtn(["api", `/v1/pages/${pageId}`, "-X", "PATCH", "-d", body]));
}

function titleFromPage(page, titleProperty) {
  return (page.properties?.[titleProperty]?.title || [])
    .map((item) => item.plain_text || item.text?.content || "")
    .join("");
}

function dateFromPage(page, dateProperty, timezone) {
  const start = page.properties?.[dateProperty]?.date?.start;
  if (!start) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  return localDate(start, timezone);
}

function localDate(iso, timezone) {
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

function validateDate(value, name) {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be YYYY-MM-DD, got ${value}`);
  }
}

function inRange(date, from, to) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function buildCoverUrl(config, date) {
  const [, month] = date.split("-");
  const background = config.cover.monthlyBackgroundColors[month] || config.cover.monthlyBackgroundColors["05"];
  const text = `${config.labelPrefix}  ${date.replaceAll("-", ".")}`;
  const params = new URLSearchParams({
    text,
    font: config.cover.font,
  });
  return `https://placehold.co/${config.cover.width}x${config.cover.height}/${background}/${config.cover.textColor}/png?${params.toString()}`;
}

function normalizePageId(value) {
  if (!value) return null;
  const match = value.match(/[0-9a-fA-F]{32}|[0-9a-fA-F-]{36}/);
  if (!match) return value;
  const compact = match[0].replaceAll("-", "");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function summarizeByMonth(items) {
  return items.reduce((acc, item) => {
    const month = item.date?.slice(5, 7) || "none";
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});
}

function emit(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Updated: ${report.updated.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Failed: ${report.failed.length}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  validateDate(args.from, "--from");
  validateDate(args.to, "--to");
  validateDate(args.date, "--date");

  const config = loadConfig(args.config);
  const inputPages = args.pageId ? [fetchPage(args.pageId)] : queryAll(config.dataSourceId);
  const report = {
    ok: true,
    dryRun: args.dryRun,
    scanned: inputPages.length,
    updated: [],
    skipped: [],
    failed: [],
    byMonth: {},
  };

  for (const page of inputPages) {
    const date = args.date || dateFromPage(page, config.dateProperty, config.timezone);
    const title = titleFromPage(page, config.titleProperty);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      report.skipped.push({ pageId: page.id, title, reason: "missing_or_invalid_date" });
      continue;
    }
    if (!inRange(date, args.from, args.to)) {
      report.skipped.push({ pageId: page.id, title, date, reason: "outside_date_window" });
      continue;
    }

    const coverUrl = buildCoverUrl(config, date);
    if (args.dryRun) {
      report.updated.push({ pageId: page.id, title, date, pageUrl: page.url, coverUrl, dryRun: true });
      continue;
    }

    try {
      const updated = patchCover(page.id, coverUrl);
      report.updated.push({
        pageId: page.id,
        title,
        date,
        pageUrl: updated.url,
        coverType: updated.cover?.type || null,
        coverUrl: updated.cover?.external?.url || null,
      });
    } catch (error) {
      report.failed.push({ pageId: page.id, title, date, error: error.message.slice(0, 700) });
    }
  }

  report.byMonth = summarizeByMonth(report.updated);
  report.ok = report.failed.length === 0;
  emit(report, args.json);
  if (!report.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
