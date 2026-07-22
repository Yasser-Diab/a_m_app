const path = require("path");

const root = __dirname;
const variants = require("./config/app-variants.json");
const packageJson = require("./package.json");

const variantKey = process.env.AM_APP_VARIANT || "main";
const variant = variants.variants[variantKey] || variants.variants.main;
const appId = `${variants.baseAppId}${variant.appIdSuffix || ""}`;
const version = process.env.AM_BUILD_VERSION || packageJson.version || variants.version;
const outputRoot = variants.desktopOutput || "dist-installer";
const outputDir = path.join(outputRoot, variant.artifactPrefix || variantKey);

module.exports = {
  appId,
  productName: variant.name,
  asar: true,
  electronDist: path.join(root, "node_modules", "electron", "dist"),
  directories: {
    output: outputDir,
  },
  files: [
    "dist/**/*",
    "electron/**/*",
    "server/**/*",
    "tools/print_pdf.cjs",
    "data/price_offer.empty.db",
    "src/assets/sticker logo s.png",
    "src/assets/export_logo.png",
    "build/**/*",
    "package.json",
    "config/app-variants.json",
  ],
  asarUnpack: [
    "data/price_offer.empty.db",
    "node_modules/sql.js/dist/*.wasm",
  ],
  extraMetadata: {
    version,
    name: packageJson.name,
    productName: variant.name,
    amVariant: variantKey,
    amEntryTab: variant.entryTab || "dashboard",
  },
  publish: [
    {
      provider: "github",
      owner: "Yasser-Diab",
      repo: "a_m_app",
      channel: "latest",
      releaseType: "release",
    },
  ],
  win: {
    icon: path.join(root, variant.icon || variants.variants.main.icon),
    executableName: variant.name,
    requestedExecutionLevel: "asInvoker",
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    artifactName: `${variant.artifactPrefix || "AccountingManagement"}-Setup-${version}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    perMachine: false,
    allowElevation: false,
    shortcutName: variant.name,
    uninstallDisplayName: variant.name,
    deleteAppDataOnUninstall: false,
    include: path.join(root, "build", "installer.nsh"),
  },
};
