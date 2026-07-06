const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const [, , targetUrl, outputPath] = process.argv;

async function main() {
  if (!targetUrl || !outputPath) throw new Error('Usage: electron tools/capture_page.cjs url output.png');
  console.log(`Capturing ${targetUrl} -> ${outputPath}`);
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 980,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
    },
  });
  await win.loadURL(targetUrl);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), image.toPNG());
  console.log(`Wrote ${outputPath}`);
  await win.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
