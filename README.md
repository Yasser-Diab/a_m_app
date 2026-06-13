# Accounting Management

Local multi-user replacement for the original Excel workbook.

## Modules

- Work item ledger imported from `QID-YD.xlsm`
- Price offers
- Tax and non-tax invoices
- Customer account statements
- Contractor certificates and statements
- Collections/payments
- Local SQLite database with configurable server URL for Android clients

## Development

```powershell
npm install
npm run import:excel
npm run dev
```

## Build

```powershell
npm run dist:win
npm run android:debug
npm run package:release
```

If Android SDK packages are missing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup_android_sdk.ps1
```
