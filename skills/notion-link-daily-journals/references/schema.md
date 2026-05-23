# Configuration Schema

Create a private config file from `examples/config.example.json`.

## Top Level

```json
{
  "timezone": "Asia/Shanghai",
  "dailyJournal": {
    "dataSourceId": "target-daily-journal-data-source-id",
    "dateProperty": "日期"
  },
  "databases": []
}
```

## Child Database

```json
{
  "name": "Flomo",
  "dataSourceId": "child-data-source-id",
  "relationProperty": "📔 关联日记",
  "date": {
    "mode": "date",
    "property": "Created At"
  },
  "titleProperties": ["Name"]
}
```

## Date Modes

| Mode | Fields | Meaning |
| --- | --- | --- |
| `date` | `property` | Use a Notion date property. |
| `created_time` | `property` | Use a Notion created time property. |
| `date_fallback` | `properties` | Use the first date property; if empty, use the second. |
| `date_created_time_fallback` | `properties` | Use a date property; if empty, use a created time property. |

## Example Mappings

These are common mappings; replace IDs with your own.

| Database | Relation property | Date rule |
| --- | --- | --- |
| Task | `📔 关联日记` | `created_time`: `创建时间` |
| Flomo | `📔 关联日记` | `date`: `Created At` |
| Podwise | `📔 关联日记` | `created_time`: `Created time` |
| Library | `📔 关联日记` | `date_fallback`: `Last Synced`, `Last Highlighted` |
| Getnotes | `📔 关联日记` | `date`: `Created At` |
| Knowledge Base | `📔 关联日记` | `created_time`: `创建时间` |
| Emails | `📔 每日日记` | `date_created_time_fallback`: `Received`, `Created time` |

## Notion CLI Notes

- Use data source IDs, not database IDs.
- `ntn datasources query <data-source-id>` queries records.
- `ntn api v1/pages/<page-id> -X PATCH` accepts JSON from stdin.
- Never commit local config files that contain private Notion IDs.