# Legacy 1.3.8 Install Guide

## What This Package Must Contain

- `dist/` web assets from `npm run build:web`
- `server/` backend files
- `data/price_offer.empty.db` clean starter database
- `package.json` and `package-lock.json`
- `README.md` and `INSTALL.txt`

The live working database `data/price_offer.db` should not be bundled into installers or release zips.

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

The Manager app remains separate. Start Manager first when testing payments.

```text
Public tunnel:  https://manager.yasserdiab.site
Public ingest:  https://manager.yasserdiab.site/api/ingest/account
Local ingest:   http://127.0.0.1:4295/api/ingest/account
```

The main app reads the Manager token from `AM_MANAGER_TOKEN`, `AM_MANAGER_TOKEN_FILE`, or `D:\manager_app\data\manager-ingest-token.txt`.

The Settings payment panel reads PayPal client data and plans from Manager. It
supports both recurring subscriptions and one-time bundle payments. Customers
can cancel renewal at any time; Manager keeps access active until the saved
paid-through date. Company managers can delete the Manager account after the
warning confirmation, which removes the Manager-side account, support history,
payments, and subscriptions.

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
