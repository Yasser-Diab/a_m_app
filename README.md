# Accounting Management

Version `1.3.9` local multi-user app for price offers, invoices, account statements, contractor certificates, and payments.

## Local Run

```powershell
npm install
npm run prepare:database
$env:PRICE_OFFER_PORT="4181"
$env:AM_MANAGER_TOKEN_FILE="D:\manager_app\data\manager-ingest-token.txt"
npm run api
```

Open the web app at `http://127.0.0.1:4181/main`.

## Manager Sync

The separated Manager app owns subscriptions and PayPal. This app sends account, users, payment summary, and diagnostics to:

```text
https://manager.yasserdiab.site/api/ingest/account
```

Use one of these token options:

```powershell
$env:AM_MANAGER_TOKEN="paste-token-here"
$env:AM_MANAGER_TOKEN_FILE="D:\manager_app\data\manager-ingest-token.txt"
```

The local fallback Manager URL is `http://127.0.0.1:4295`.

Payments in Settings use the Manager PayPal credentials. Customers can choose a
recurring PayPal subscription or a one-time bundle payment. Recurring payments
use PayPal subscriptions; one-time payments use PayPal order capture with the
embedded card fields. Cancellation stops future renewals but keeps access until
the paid-through date returned by Manager.

Company managers can delete the local company account from Settings after the
admin unlock and confirmation phrase. The app first archives the current
database under `data/deleted_company_archives`, then clears local saved users,
chat, documents, payments, and subscription state from the working database.

## Build Prep

The desktop builder now includes `data/price_offer.empty.db`, not the live working database. Refresh it before packaging:

```powershell
npm run prepare:database
npm run build:web
```

When you are ready to package apps yourself:

```powershell
npm run dist:win
npm run android:debug
npm run package:release
```
