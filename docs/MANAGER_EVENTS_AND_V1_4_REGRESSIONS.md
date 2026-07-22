# Manager events and Version 1.4 regression contract

This document describes the notification mapping added for the Version 1.4
regression work and the rules that the user and manager applications must keep
in sync.

## Event types

The supported `event_type` values are:

- `information`: a normal information notification.
- `warning`: a warning requiring stronger visual emphasis.
- `offer`: a promotional event with optional `offer_price` and
  `offer_details`.

Titles are never generated from the type. The manager supplies both `title`
and `message` for every event.

## Manager workflow

The manager opens the Events section in the Manager page, selects a type, and
enters the title and complete message. The manager may then set start and
expiry date/time, user and company targets, background/text/border colors,
offer details, in-app delivery, Windows delivery, and active status.

An empty target list means all users or all companies. When both user and
company targets are supplied, both constraints must match. User and company
values are compared case-insensitively. Dates are stored as ISO-compatible
text and evaluated by the server.

## HTTP mapping

### Manager endpoints

- `GET /api/manager/events`: lists all events. Manager authentication is
  required through the existing manager credentials.
- `POST /api/manager/events`: creates an event.
- `PUT /api/manager/events/:id`: edits an event or changes its active state.

Create/update payload fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `event_type` | string | `information`, `warning`, or `offer` |
| `title` | string | Manager-written title; required |
| `message` | string | Manager-written details; required |
| `target_users` | string[] or delimited string | User IDs or login names |
| `target_companies` | string[] or delimited string | Company names |
| `style` | object | Editable `background`, `color`, and `borderColor` values |
| `offer_price` | string | Optional displayed offer value |
| `offer_details` | string | Optional offer-specific details |
| `starts_at` | string | Optional activation date/time |
| `expires_at` | string | Optional expiry date/time |
| `in_app_enabled` | boolean | Show inside the application |
| `windows_enabled` | boolean | Request a Windows notification |
| `active` | boolean | Manager activation switch |
| `created_by` | string | Manager identity for audit display/storage |

### User endpoints

- `GET /api/events?user_id=...&username=...&company=...` returns only active,
  started, non-expired, targeted, non-dismissed events.
- `POST /api/events/:id/seen` records that the user displayed the event.
- `POST /api/events/:id/dismiss` prevents it from appearing again for that
  user.
- `POST /api/events/:id/notified` prevents duplicate Windows notifications.

Action payloads contain `user_id` or `user_key`. Event delivery/action routes
remain available even if subscription access is blocked, so warnings can be
acknowledged without creating a repeat-notification loop.

## Database mapping

`manager_events` stores the event ID, type, title, message, JSON user/company
targets, JSON style, offer fields, start/expiry dates, delivery flags, active
state, creator, creation time, and update time.

`manager_event_user_state` is keyed by `(event_id, user_key)` and stores
`seen_at`, `dismissed_at`, and `notified_at`. It is deliberately separate from
the event so each user has independent state.

## Delivery rules

The user application refreshes events on startup, periodically, and when the
window regains focus. In-app events are shown at the top of Settings in the
collapsed event center. Windows notifications are emitted once where the
desktop integration is available. Expired, inactive, untargeted, and dismissed
events are filtered by the server. A notification is marked as notified only
after the delivery attempt.

## Report grouping contract

The PDF, Excel, and on-screen report must consume the same location rules:

- One building and one unit on every row are placed in the project heading;
  no body subheadings are emitted.
- Ungrouped rows come first and never receive a synthetic building/unit name.
- Direct building rows come before real unit sections.
- Building and unit subtotal switches are independent. Building totals include
  direct rows and all unit rows; unit totals include only their own rows.
- Regular report columns are `البيان`, `الوحدة`, `المقاس` when dimensions
  exist, `العدد`, `الكمية`, and `الإجمالي`.
- Width/height are displayed whenever entered, including for the `عدد` unit.

## Branding contract

Every report-data branch, including account statements, carries the normalized
`branding` object. HTML/PDF, preview, and Excel use the configured Arabic and
English company names, logo, heading color, separator color, table colors,
fonts, address, phone, and footer mode. A report-specific data branch must not
return before attaching branding.

## Report save mapping

When a default report directory is configured, the desktop application creates
and uses these subfolders:

| Report type | Subfolder |
| --- | --- |
| Price offer | `Price Offers` |
| Invoice | `Invoices` |
| Account statement | `Account Statements` |
| Productive quantities | `الانتاجية` |
| Contractor certificate | `Contractor Certifications` |

Without a default directory, the last successful folder is remembered for the
next save dialog. Successful saves return the absolute file path to the in-app
notification. Automatic PDF opening is controlled only by the
`openPdfAfterSaving` desktop setting.
