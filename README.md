# Easy Commercial

Version `v2.0.3` keeps the Easy Commercial quote, invoice, accounts, payment, smart-table, and report systems while improving localized report units/filenames, contractor certificate report options, and local-server startup reliability.

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

Only the main Easy Commercial app is built:

- Windows: `EasyCommercial-Setup-<version>.exe`
- Android: `EasyCommercial-Android-v<version>-debug.apk`

```powershell
npm run build:web
npm run dist:win
npm run android:debug
```

Static browser files are copied to `static-web/` after release prep.

## Backend

The app uses the local/manual server and optional tunnel mode. Do not put service-role keys, database passwords, or payment secrets in the client.
