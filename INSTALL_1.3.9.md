# Accounting Management 1.3.9 Install Guide

## Package Contents

- `dist/` web assets from `npm run build:web`
- `server/` backend files
- `data/price_offer.empty.db` clean starter database
- `package.json` and `package-lock.json`
- `README.md`, `INSTALL.txt`, and this guide

Do not bundle the live working database `data/price_offer.db` into installers or release zips.

## First Run On A New Machine

```powershell
npm install
npm run prepare:database
$env:PRICE_OFFER_PORT="4181"
$env:AM_MANAGER_TOKEN_FILE="D:\manager_app\data\manager-ingest-token.txt"
npm run api
```

Open:

```text
http://127.0.0.1:4181/main
```

## Manager And PayPal

The Manager app remains separate and owns PayPal credentials, plans, subscription status, and diagnostics ingestion.

```text
Public tunnel:  https://yasserdiab.site
Public ingest:  https://yasserdiab.site/api/ingest/account
Local ingest:   http://127.0.0.1:4295/api/ingest/account
```

The main app reads the Manager token from `D:\manager_app\data\manager-ingest-token.txt` first, then falls back to `AM_MANAGER_TOKEN_FILE` or `AM_MANAGER_TOKEN`.

The Settings payment panel reads PayPal client data and plans from Manager. It supports recurring PayPal subscriptions and one-time bundle payments. Canceling renewal keeps access active until the paid-through date returned by Manager.

## Account Deletion

The Settings danger zone deletes the local company account, not only the Manager copy. It creates a database archive first under `data/deleted_company_archives`, then clears local saved users, chat, documents, payments, and subscription state from the working database.

## Builder Prep Only

To prepare assets before you build installers yourself:

```powershell
npm run prepare:database
npm run build:web
```

Then run your chosen package command:

```powershell
npm run dist:win
npm run android:debug
```
