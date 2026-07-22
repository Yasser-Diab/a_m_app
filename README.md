# Accounting Management

Version `v1.4.3` restores the category column in price-offer and invoice reports and keeps the v1.4 smart-table and access-control fixes intact.

## Development

```powershell
npm install
npm run dev
```

The local API server stores data in `D:\AM_Data\price_offer.db` by default. For browser testing, run the API and open:

```text
http://127.0.0.1:4190/main
```

## App Flow

- Start from the company login screen.
- Use the create-account tab to create a local company database automatically.
- Existing users log in against the local server or tunnel URL.
- Active login state is session based; reopening the app starts a new session.

## Builds

Only the main Accounting Management app is built:

- Windows: `AccountingManagement-Setup-<version>.exe`
- Android: `AccountingManagement-Android-v<version>-debug.apk`

```powershell
npm run build:web
npm run dist:win
npm run android:debug
```

Static browser files are copied to `static-web/` after release prep.

## Backend

The app uses the local/manual server and optional tunnel mode. Do not put service-role keys, database passwords, or payment secrets in the client.
