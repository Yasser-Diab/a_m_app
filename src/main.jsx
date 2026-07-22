import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal, flushSync } from "react-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Bell,
  Building2,
  Check,
  ClipboardList,
  Cloud,
  Copy,
  CornerUpLeft,
  Database,
  FileDown,
  FileSpreadsheet,
  FileText,
  Files,
  FolderOpen,
  HardDrive,
  Download,
  Eye,
  KeyRound,
  LogOut,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  Minimize2,
  Monitor,
  Moon,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Smile,
  Square,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  WalletCards,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import appLogo from "./assets/sticker logo s.png";
import { CHAT_EMOJI_CATEGORIES } from "./emoji-data.js";
import {
  applySmartClipboardGridToRows,
  expandSmartClipboardGrid,
  fillSmartSelectionDownRows,
  findSmartCtrlArrowDestination,
  findSmartTableMatches,
  hasExplicitSmartValue,
  insertSmartRowRelative,
  isSmartFillDownShortcut,
  normalizeSmartNumericClipboardValue,
  parseSmartClipboardGrid,
  replaceSmartSearchMatches,
  removeSmartRowById,
  smartSelectionAfterNavigation,
} from "./smart-table-clipboard.mjs";
import {
  loadManagerPayments,
  loadManagerSubscriptionConfig,
  loadManagerSubscriptionStatus,
  renderManagerPayPalCheckout,
} from "./manager-paypal-checkout.js";
import "./styles.css";

const APP_NAME = "Accounting Management";
const APP_VERSION =
  window.priceOfferDesktop?.installedVersion ||
  import.meta.env.VITE_APP_VERSION ||
  "1.4.3";
const APP_RELEASE_LABEL = APP_VERSION;
const APP_DISPLAY_VERSION = APP_RELEASE_LABEL || APP_VERSION;
const APP_MARK = "A.M";
const APP_BYLINE = "By Y.D";
const DEFAULT_LOCAL_HOST = "192.168.137.1";
const DEFAULT_LOCAL_PORT = 4181;
const DEFAULT_API_BASE = `http://${DEFAULT_LOCAL_HOST}:${DEFAULT_LOCAL_PORT}`;
const MANAGER_API_BASE = "https://manager.yasserdiab.site";
const MANAGER_PUBLIC_URL = "https://manager.yasserdiab.site";
const SERVICE_TERMS_VERSION = "2026-06-27";
const SERVICE_TERMS_STORAGE_KEY = "accountingManagementTermsAcceptedVersion";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Accounting Management render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="login-shell app-crash-shell" dir="rtl">
        <section className="login-panel">
          <div className="login-brand">
            <AppBrandMark small />
            <div>
              <strong>{APP_NAME}</strong>
              <span>{APP_BYLINE}</span>
            </div>
          </div>
          <div className="notice">
            تعذر فتح الشاشة الحالية: {this.state.error.message || "Unknown error"}
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => {
              sessionStorage.removeItem("priceOfferUser");
              window.location.reload();
            }}
          >
            <RefreshCw size={18} /> رجوع لتسجيل الدخول
          </button>
        </section>
      </main>
    );
  }
}

const NAV = [
  { id: "dashboard", label: "لوحة التحكم", icon: Activity },
  { id: "offer", label: "عروض الأسعار", icon: FileText },
  { id: "invoice", label: "الفواتير", icon: ReceiptText },
  { id: "statement", label: "كشف حساب", icon: WalletCards },
  { id: "payments", label: "الدفعات", icon: WalletCards },
  { id: "contractor", label: "المقاولين", icon: ClipboardList },
  { id: "quantities", label: "الكميات المنتجة", icon: FileSpreadsheet },
  { id: "entry", label: "إدخال / تعديل", icon: Plus },
  { id: "settings", label: "الإعدادات", icon: Settings },
];

const APP_VARIANTS = {
  main: { name: APP_NAME, defaultTab: "dashboard", allowedTabs: null },
};

const ROUTE_APP_VARIANTS = {
  main: "main",
  dashboard: "main",
  invoice: "main",
  invoices: "main",
  entry: "main",
  settings: "main",
  quantities: "main",
  "productive-quantities": "main",
  payment: "main",
  payments: "main",
  offer: "main",
  offers: "main",
  "price-offers": "main",
  statement: "main",
  statements: "main",
  "account-statement": "main",
  contractor: "main",
  contractors: "main",
  certificate: "main",
  certificates: "main",
  "contractor-certificates": "main",
};

const ROUTE_INITIAL_TABS = {
  main: "dashboard",
  dashboard: "dashboard",
  offer: "offer",
  offers: "offer",
  "price-offers": "offer",
  invoice: "invoice",
  invoices: "invoice",
  statement: "statement",
  statements: "statement",
  "account-statement": "statement",
  payment: "payments",
  payments: "payments",
  contractor: "contractor",
  contractors: "contractor",
  certificate: "contractor",
  certificates: "contractor",
  "contractor-certificates": "contractor",
  entry: "entry",
  settings: "settings",
  quantities: "quantities",
  "productive-quantities": "quantities",
};

function currentRouteKey() {
  return (
    window.location.pathname
      .split("/")
      .filter(Boolean)[0]
      ?.toLowerCase() || ""
  );
}

function getAppVariant() {
  return APP_VARIANTS[ROUTE_APP_VARIANTS[currentRouteKey()] || "main"];
}

const APP_VARIANT = getAppVariant();
const APP_VARIANT_ID = "main";
const INITIAL_ACTIVE_TAB = ROUTE_INITIAL_TABS[currentRouteKey()] || APP_VARIANT.defaultTab;
const NAV_ITEMS = NAV;

const WORKFLOWS = {
  offer: {
    label: "عروض الأسعار",
    partyLabel: "العميل",
    partyRole: "customer",
    documentType: "price_offer",
    documentStatus: "draft",
    reportType: "offer",
    defaultDocumentStatus: "draft",
  },
  invoice: {
    label: "الفواتير",
    partyLabel: "العميل",
    partyRole: "customer",
    documentType: "invoice",
    reportType: "invoice",
    defaultDocumentStatus: "approved",
  },
  statement: {
    label: "كشف حساب عميل",
    partyLabel: "العميل",
    partyRole: "customer",
    documentType: "invoice",
    documentStatus: "approved",
    reportType: "statement",
    defaultDocumentStatus: "approved",
  },
  contractor: {
    label: "مستخلصات المقاولين",
    partyLabel: "المقاول",
    partyRole: "contractor",
    documentType: "contractor_certificate",
    reportType: "contractor",
    defaultDocumentStatus: "approved",
  },
};

const DOCUMENT_TYPES = [
  { value: "price_offer", label: "عرض سعر", role: "customer", status: "draft" },
  { value: "invoice", label: "فاتورة", role: "customer", status: "approved" },
  {
    value: "contractor_certificate",
    label: "مستخلص مقاول",
    role: "contractor",
    status: "approved",
  },
];

const UNITS = [
  { value: "sqm", label: "\u0645\u00b2" },
  { value: "lm", label: "\u0645.\u0637" },
  { value: "count", label: "\u0639\u062f\u062f" },
];

const TAXES = [
  { key: "vat_enabled", label: "ضريبة القيمة المضافة 14%" },
  { key: "social_insurance_enabled", label: "تأمينات اجتماعية 3.6%" },
  { key: "stamp_enabled", label: "دمغة هندسية 0.001" },
  { key: "works_insurance_enabled", label: "تأمينات أعمال 5%" },
  { key: "final_insurance_enabled", label: "تأمين أعمال نهائي 5%" },
  { key: "contractor_tax_enabled", label: "ضريبة 1%" },
];

const VAT_TERMS_ONLY_OPTION = {
  key: "vat_terms_only",
  label: "الأسعار تشمل ضريبة 14% في الشروط فقط (بدون احتساب)",
};

const DEFAULT_ENTRY = {
  party_role: "customer",
  party_category: "unselected",
  source_customer_id: "",
  source_customer_name: "",
  certificate_no: "",
  work_types: [],
  document_type: "price_offer",
  document_status: "draft",
  entry_date: new Date().toISOString().slice(0, 10),
  building_unit: "",
  floor_apartment: "",
  measurement_mode: "standard",
  unit_code: "sqm",
  item_count: 1,
  total_quantity: "",
  width_cm: "",
  height_cm: "",
  rate: "",
  vat_enabled: false,
  vat_terms_only: false,
  social_insurance_enabled: false,
  stamp_enabled: false,
  works_insurance_enabled: false,
  final_insurance_enabled: false,
  contractor_tax_enabled: false,
  discount_type: "none",
  discount_value: "",
};

function getInitialApiBase() {
  const currentOrigin = getCurrentOriginApiBase();
  if (shouldPinApiBaseToCurrentOrigin() && currentOrigin) return currentOrigin;
  const stored = cleanApiBase(localStorage.getItem("priceOfferApiBase"));
  const storedMode = localStorage.getItem("priceOfferConnectionMode");
  if (
    (storedMode === "remote" || (stored && !isLocalApiBase(stored))) &&
    isApiBaseUsableOnCurrentPage(stored)
  ) {
    return stored;
  }
  const desktopApi = cleanApiBase(window.priceOfferDesktop?.apiBase);
  if (isApiBaseUsableOnCurrentPage(desktopApi)) return desktopApi;
  if (isApiBaseUsableOnCurrentPage(stored)) return stored;
  if (isApiBaseUsableOnCurrentPage(currentOrigin)) return currentOrigin;
  return safeApiBaseForCurrentPage(DEFAULT_API_BASE);
}

function money(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  );
}

function formatMonetaryTotal(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

let lastEditableFocusTarget = null;

function isEditableFocusTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function restoreInputInteractivity(target = null) {
  window.priceOfferDesktop?.restoreInputFocus?.().catch?.(() => {});
  const repair = () => {
    document.documentElement.removeAttribute("inert");
    document.body?.removeAttribute("inert");
    document.body?.classList.remove("input-locked", "modal-open", "is-busy");
    if (document.body?.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
    const focusTarget =
      target && target.isConnected
        ? target
        : lastEditableFocusTarget?.isConnected
          ? lastEditableFocusTarget
          : document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
    if (isEditableFocusTarget(focusTarget)) {
      if (!focusTarget.disabled && !focusTarget.readOnly) {
        focusTarget.focus({ preventScroll: true });
      }
    }
  };
  window.requestAnimationFrame(repair);
  window.setTimeout(repair, 60);
  window.setTimeout(repair, 180);
}

function userWithFreshSession(user = null) {
  if (!user) return null;
  const now = new Date().toISOString();
  return {
    ...user,
    session_started_at: user.session_started_at || user.last_login_at || now,
    last_seen_at: user.last_seen_at || now,
    is_online: navigator.onLine !== false,
  };
}

function compactDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatUserDateTime(value) {
  if (!value) return "-";
  const normalized = String(value).includes("T")
    ? String(value)
    : `${String(value).replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function workTimeLabel(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function text(value) {
  return value === null || value === undefined || value === ""
    ? " "
    : String(value);
}

function dateInputValue(value) {
  return String(value || "").slice(0, 10);
}

function freshEntryDefaults(patch = {}) {
  return {
    ...DEFAULT_ENTRY,
    entry_date: new Date().toISOString().slice(0, 10),
    ...patch,
  };
}

function variantEntryDefaults(patch = {}) {
  if (APP_VARIANT.forcedDocumentType === "contractor_certificate") {
    return freshEntryDefaults({
      ...patch,
      document_type: "contractor_certificate",
      document_status: "approved",
      party_role: "contractor",
    });
  }
  return freshEntryDefaults(patch);
}

function statementOf(row) {
  return (
    row.statement_text ||
    [row.description, row.glass_spec, row.profile_spec, row.color]
      .filter(Boolean)
      .join("\n") ||
    row.collection_note ||
    ""
  );
}

function normalizeClientUnitCode(value) {
  const text = String(value || "").trim().toLowerCase();
  if (
    [
      "sqm",
      "m2",
      "m^2",
      "meter2",
      "square meter",
      "square meters",
      "square metre",
      "square metres",
      "م²",
      "م٢",
      "متر مربع",
    ].includes(text)
  )
    return "sqm";
  if (
    [
      "lm",
      "linear",
      "linear meter",
      "linear meters",
      "linear metre",
      "linear metres",
      "long",
      "long meter",
      "long meters",
      "م.ط",
      "مط",
      "متر طولي",
    ].includes(text)
  )
    return "lm";
  if (
    [
      "count",
      "number",
      "no",
      "nos",
      "pcs",
      "piece",
      "pieces",
      "unit",
      "units",
      "عدد",
      "وحدة",
      "وحده",
      "قطعة",
    ].includes(text)
  )
    return "count";
  return "sqm";
}

function reportHasDimensions(rows = []) {
  return rows.some(
    (row) =>
      (normalizeClientUnitCode(row.unit_code || row.unit) === "sqm" ||
        normalizeClientUnitCode(row.unit_code || row.unit) === "lm") &&
      Number(row.width_cm || 0) > 0,
  );
}

function rowDimension(row, unit = "cm") {
  const width = Number(row.width_cm || 0);
  const height = Number(row.height_cm || 0);
  const unitCode = normalizeClientUnitCode(row.unit_code || row.unit);
  const FSI = "\u2068";
  const PDI = "\u2069";
  const unitLabel = unit === "m" ? "\u0645" : "\u0633\u0645";
  if (unitCode === "sqm") {
    if (!width || !height) return "";
    const w = unit === "m" ? money(width / 100) : money(width);
    const h = unit === "m" ? money(height / 100) : money(height);
    return `${FSI}${w} \u00d7 ${h} ${unitLabel}${PDI}`;
  }
  if (unitCode === "lm") {
    if (!width) return "";
    const w = unit === "m" ? money(width / 100) : money(width);
    return `${FSI}${w} ${unitLabel}${PDI}`;
  }
  return "";
}

function uniqueValues(values) {
  return [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ].slice(0, 120);
}

function naturalTextCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), "ar", {
    numeric: true,
    sensitivity: "base",
  });
}

function splitLocationParts(value) {
  return String(value || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function rowBuildingName(row = {}) {
  return splitLocationParts(row.building_unit)[0] || "";
}

function rowUnitName(row = {}) {
  const explicitParts = splitLocationParts(row.floor_apartment);
  if (explicitParts.length > 1) return explicitParts[explicitParts.length - 1];
  if (explicitParts.length === 1) {
    const building = rowBuildingName(row);
    return normalizeArabic(explicitParts[0]) === normalizeArabic(building)
      ? ""
      : explicitParts[0];
  }
  const combinedParts = splitLocationParts(row.building_unit);
  return combinedParts.length > 1 ? combinedParts[combinedParts.length - 1] : "";
}

function distinctReportLocationValues(values = []) {
  const unique = [];
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    const normalized = normalizeArabic(value);
    if (unique.some((item) => item.normalized === normalized)) continue;
    unique.push({ value, normalized });
  }
  return unique.map((item) => item.value).sort(naturalTextCompare);
}

function reportLocationContext(rows = [], fallback = {}) {
  const printableRows = (rows || []).filter(
    (row) => row && typeof row === "object",
  );
  const sourceRows = printableRows.length
    ? printableRows
    : fallback && (fallback.building_unit || fallback.floor_apartment)
      ? [fallback]
      : [];
  const buildings = distinctReportLocationValues(
    sourceRows.map(rowBuildingName),
  );
  const units = distinctReportLocationValues(sourceRows.map(rowUnitName));
  return {
    buildings,
    units,
    hasSingleBuilding: buildings.length === 1,
    hasSingleUnit: buildings.length === 1 && units.length === 1,
  };
}

function rowLocationLabel(row = {}) {
  const parts = [];
  for (const source of [rowBuildingName(row), rowUnitName(row)]) {
    for (const rawPart of splitLocationParts(source)) {
      const part = rawPart.trim();
      if (!part) continue;
      const normalized = normalizeArabic(part);
      if (parts.some((item) => item.normalized === normalized)) continue;
      parts.push({ value: part, normalized });
    }
  }
  return parts.map((part) => part.value).join(" / ");
}

function locationPartValues(rows = [], key) {
  const parts = [];
  for (const row of rows || []) {
    for (const rawPart of String(row?.[key] || "").split("/")) {
      const part = rawPart.trim();
      if (!part) continue;
      const normalized = normalizeArabic(part);
      if (parts.some((item) => item.normalized === normalized)) continue;
      parts.push({ value: part, normalized });
    }
  }
  return parts.map((part) => part.value).sort(naturalTextCompare);
}

function singleDocumentLocation(form = {}, rows = []) {
  const documentRows = rows || [];
  if (documentRows.length) {
    const buildings = uniqueValues(documentRows.map(rowBuildingName).filter(Boolean)).sort(
      naturalTextCompare,
    );
    const units = uniqueValues(documentRows.map(rowUnitName).filter(Boolean)).sort(naturalTextCompare);
    const everyRowHasTheSameLocation =
      buildings.length === 1 &&
      units.length <= 1 &&
      documentRows.every(
        (row) =>
          normalizeArabic(rowBuildingName(row)) === normalizeArabic(buildings[0]) &&
          normalizeArabic(rowUnitName(row)) === normalizeArabic(units[0] || ""),
      );
    if (everyRowHasTheSameLocation)
      return [buildings[0], units[0]].filter(Boolean).join(" ");
    return "";
  }
  return rowLocationLabel(form);
}

function projectWithLocation(project, location) {
  const projectText = String(project || "").trim();
  const locationText = String(location || "").trim();
  if (!locationText) return projectText;
  if (!projectText) return locationText;
  if (normalizeArabic(projectText).includes(normalizeArabic(locationText))) {
    return projectText;
  }
  return `${projectText} ${locationText}`;
}

function reportProjectHeading(project, rows = [], fallback = {}) {
  const projectText = String(project || "").trim();
  const { buildings, units, hasSingleBuilding, hasSingleUnit } =
    reportLocationContext(rows, fallback);
  const parts = [];
  const append = (rawValue) => {
    const value = String(rawValue || "").trim();
    if (!value) return;
    const normalized = normalizeArabic(value);
    if (
      parts.some((part) => {
        const existing = normalizeArabic(part);
        return existing === normalized || existing.includes(normalized);
      })
    ) {
      return;
    }
    parts.push(value);
  };
  append(projectText);
  if (hasSingleBuilding) append(buildings[0]);
  if (hasSingleUnit) append(units[0]);
  return parts.join(" - ");
}

function subtotalFlagsFromMode(mode = "none") {
  if (mode && typeof mode === "object") {
    return {
      building: !!mode.building,
      unit: !!mode.unit,
    };
  }
  const value = String(mode || "none").toLowerCase();
  return {
    building:
      value === "building" ||
      value === "both" ||
      value === "building_unit" ||
      value === "unit_building",
    unit:
      value === "unit" ||
      value === "both" ||
      value === "building_unit" ||
      value === "unit_building",
  };
}

function encodeSubtotalMode(flags = {}) {
  if (flags.building && flags.unit) return "building_unit";
  if (flags.building) return "building";
  if (flags.unit) return "unit";
  return "none";
}

function rowGroupKey(value, fallback = "") {
  const label = String(value || fallback || "").trim();
  return {
    key: normalizeArabic(label) || "__blank__",
    label,
  };
}

function addReportTotals(target, row = {}) {
  target.item_count += num(row.item_count);
  target.quantity += num(row.quantity);
  target.gross_total += num(row.gross_total);
  target.work_gross_total += num(row.work_gross_total || row.gross_total);
  target.net_total += num(row.net_total);
}

function blankReportTotals() {
  return {
    item_count: 0,
    quantity: 0,
    gross_total: 0,
    work_gross_total: 0,
    net_total: 0,
  };
}

function buildReportRowBlocks(rows = [], subtotalMode = "none") {
  const realRows = rows || [];
  const flags = subtotalFlagsFromMode(subtotalMode);
  if (!realRows.length) return [];

  const indexedRows = realRows.map((row, index) => ({ row, index }));
  const { buildings, units, hasSingleBuilding, hasSingleUnit } =
    reportLocationContext(realRows);
  if (!buildings.length) {
    return indexedRows.map(({ row }) => ({ type: "row", row }));
  }

  const blocks = [];
  indexedRows
    .filter(({ row }) => !rowBuildingName(row))
    .sort((left, right) => left.index - right.index)
    .forEach(({ row }) => blocks.push({ type: "row", row }));

  if (hasSingleBuilding) {
    const buildingLabel = buildings[0];
    const buildingRows = indexedRows.filter(
      ({ row }) =>
        normalizeArabic(rowBuildingName(row)) ===
        normalizeArabic(buildingLabel),
    );
    const buildingTotals = blankReportTotals();
    buildingRows.forEach(({ row }) => addReportTotals(buildingTotals, row));

    if (hasSingleUnit) {
      buildingRows
        .sort((left, right) => left.index - right.index)
        .forEach(({ row }) => blocks.push({ type: "row", row }));
      if (flags.unit) {
        const unitTotals = blankReportTotals();
        buildingRows
          .filter(({ row }) => rowUnitName(row))
          .forEach(({ row }) => addReportTotals(unitTotals, row));
        blocks.push({
          type: "subtotal",
          level: "unit",
          label: units[0],
          totals: unitTotals,
        });
      }
    } else {
      buildingRows
        .filter(({ row }) => !rowUnitName(row))
        .sort((left, right) => left.index - right.index)
        .forEach(({ row }) => blocks.push({ type: "row", row }));
      const unitGroups = new Map();
      for (const item of buildingRows.filter(({ row }) => rowUnitName(row))) {
        const unit = rowGroupKey(rowUnitName(item.row));
        if (!unitGroups.has(unit.key)) {
          unitGroups.set(unit.key, {
            label: unit.label,
            rows: [],
            totals: blankReportTotals(),
          });
        }
        const group = unitGroups.get(unit.key);
        group.rows.push(item);
        addReportTotals(group.totals, item.row);
      }
      [...unitGroups.values()]
        .sort((left, right) => naturalTextCompare(left.label, right.label))
        .forEach((unit) => {
          blocks.push({ type: "heading", level: "unit", label: unit.label });
          unit.rows
            .sort((left, right) => left.index - right.index)
            .forEach(({ row }) => blocks.push({ type: "row", row }));
          if (flags.unit) {
            blocks.push({
              type: "subtotal",
              level: "unit",
              label: unit.label,
              totals: unit.totals,
            });
          }
        });
    }
    if (flags.building) {
      blocks.push({
        type: "subtotal",
        level: "building",
        label: buildingLabel,
        totals: buildingTotals,
      });
    }
    return blocks;
  }

  const buildingGroups = new Map();
  for (const item of indexedRows.filter(({ row }) => rowBuildingName(row))) {
    const building = rowGroupKey(rowBuildingName(item.row));
    if (!buildingGroups.has(building.key)) {
      buildingGroups.set(building.key, {
        key: building.key,
        label: building.label,
        rows: [],
        totals: blankReportTotals(),
      });
    }
    const group = buildingGroups.get(building.key);
    group.rows.push(item);
    addReportTotals(group.totals, item.row);
  }

  [...buildingGroups.values()]
    .sort((left, right) => naturalTextCompare(left.label, right.label))
    .forEach((building) => {
      blocks.push({ type: "heading", level: "building", label: building.label });

      building.rows
        .filter(({ row }) => !rowUnitName(row))
        .sort((left, right) => left.index - right.index)
        .forEach(({ row }) => blocks.push({ type: "row", row }));

      const unitGroups = new Map();
      for (const item of building.rows.filter(({ row }) => rowUnitName(row))) {
        const unit = rowGroupKey(rowUnitName(item.row));
        if (!unitGroups.has(unit.key)) {
          unitGroups.set(unit.key, {
            label: unit.label,
            rows: [],
            totals: blankReportTotals(),
          });
        }
        const group = unitGroups.get(unit.key);
        group.rows.push(item);
        addReportTotals(group.totals, item.row);
      }
      [...unitGroups.values()]
        .sort((left, right) => naturalTextCompare(left.label, right.label))
        .forEach((unit) => {
          blocks.push({ type: "heading", level: "unit", label: unit.label });
          unit.rows
            .sort((left, right) => left.index - right.index)
            .forEach(({ row }) => blocks.push({ type: "row", row }));
          if (flags.unit) {
            blocks.push({
              type: "subtotal",
              level: "unit",
              label: unit.label,
              totals: unit.totals,
            });
          }
        });
      if (flags.building) {
        blocks.push({
          type: "subtotal",
          level: "building",
          label: building.label,
          totals: building.totals,
        });
      }
    });
  return blocks;
}

const UNASSIGNED_PROJECT = "__unassigned__";

function cleanProjectName(value) {
  const project = String(value || "").trim();
  return project === "كل المشاريع" ? "" : project;
}

function compactId(value) {
  return String(value || "")
    .trim()
    .replace(/^0+(?=\d)/, "");
}

function firstDocumentToken(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : "";
}

function reportHasContent(payload) {
  if (!payload) return false;
  return Boolean(
    (payload.rows || []).length ||
      (payload.statementRows || []).length ||
      (payload.paymentRows || []).length ||
      (payload.summaryRows || []).length,
  );
}

function documentOptionText(doc = {}) {
  const id = doc.operation_no || doc.document_no || doc.id || "";
  const party = doc.customer_name || doc.display_name || doc.base_name || "";
  const project = doc.project || "";
  return [id, party, project].filter(Boolean).join(" - ");
}

function documentMatchesSearch(doc = {}, value = "") {
  const needle = compactId(value);
  if (!needle) return false;
  return [doc.operation_no, doc.document_no, doc.id].some((candidate) =>
    compactId(candidate).includes(needle),
  );
}

function normalizeArabic(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0640/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function lookupValues(items = []) {
  return items.map(
    (item) => item.value || item.base_name || item.display_name || item,
  );
}

function buildUrl(apiBase, path) {
  return `${apiBase || ""}${path}`;
}

function cleanApiBase(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function isPrivateOrLocalHostname(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  return (
    ["127.0.0.1", "localhost", "::1", DEFAULT_LOCAL_HOST].includes(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function getCurrentOriginApiBase() {
  if (!location.protocol.startsWith("http") || location.port === "5173") {
    return "";
  }
  const currentOrigin = cleanApiBase(location.origin);
  return isHostedManagerApiBase(currentOrigin) ? "" : currentOrigin;
}

function shouldPinApiBaseToCurrentOrigin() {
  return (
    location.protocol === "https:" &&
    !window.priceOfferDesktop &&
    !isPrivateOrLocalHostname(location.hostname)
  );
}

function isApiBaseUsableOnCurrentPage(value) {
  const clean = cleanApiBase(value);
  if (!clean || isHostedManagerApiBase(clean)) return false;
  try {
    const url = new URL(clean);
    if (location.protocol === "https:" && url.protocol === "http:") {
      return false;
    }
    if (shouldPinApiBaseToCurrentOrigin() && isLocalApiBase(clean)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function safeApiBaseForCurrentPage(value, fallback = "") {
  const clean = cleanApiBase(value);
  if (isApiBaseUsableOnCurrentPage(clean)) return clean;
  const fallbackClean = cleanApiBase(fallback);
  if (isApiBaseUsableOnCurrentPage(fallbackClean)) return fallbackClean;
  const currentOrigin = getCurrentOriginApiBase();
  if (isApiBaseUsableOnCurrentPage(currentOrigin)) return currentOrigin;
  return clean || fallbackClean || DEFAULT_API_BASE;
}

function hasManagerClientPack() {
  return true;
}

function managerClientErrorMessage(error) {
  const text = String(error?.message || "").trim();
  if (/Missing Manager client credential|Authentication required/i.test(text)) {
    return "تعذر الاتصال بالسيرفر المحلي. تأكد من تشغيله أو اختر رابط السيرفر/التنل الصحيح.";
  }
  return text || "تعذر الاتصال مع Manager.";
}

function normalizeServerConfigDraft(config = {}, apiBase = DEFAULT_API_BASE) {
  const dataDir = config.preferredDataDir || config.dataDir || "";
  const dbPath = config.preferredDbPath || config.dbPath || "";
  return {
    serverUrl: safeApiBaseForCurrentPage(
      apiBase || config.serverUrl || DEFAULT_API_BASE,
      apiBase || DEFAULT_API_BASE,
    ),
    dataDir,
    dbPath,
    migrateFromDbPath: "",
    migrateToDbPath: dbPath,
    databaseProvider: config.databaseProvider || "local",
    remoteDatabaseUrl: config.remoteDatabaseUrl || "",
    port: config.port || DEFAULT_LOCAL_PORT,
    lanIps: Array.isArray(config.lanIps) ? config.lanIps : [],
    activeDataDir: config.dataDir || dataDir,
    activeDbPath: config.dbPath || dbPath,
  };
}

function versionParts(value) {
  return String(value || "")
    .split(/[^\d]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => Number(part) || 0);
}

function compareAppVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

function isLocalApiBase(value) {
  try {
    const url = new URL(cleanApiBase(value));
    return isPrivateOrLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackApiBase(value) {
  try {
    const hostname = new URL(cleanApiBase(value)).hostname.toLowerCase();
    return ["127.0.0.1", "localhost", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function connectionModeForApiBase(value, explicitMode = "") {
  if (["local", "remote"].includes(explicitMode)) return explicitMode;
  const clean = cleanApiBase(value);
  const desktopApi = cleanApiBase(window.priceOfferDesktop?.apiBase);
  const desktopMode = window.priceOfferDesktop?.connectionMode;
  if (clean && clean === desktopApi && ["local", "remote"].includes(desktopMode)) {
    return desktopMode;
  }
  if (isLoopbackApiBase(clean)) return "local";
  return "remote";
}

function isHostedManagerApiBase(value) {
  const clean = cleanApiBase(value || DEFAULT_API_BASE);
  return /\/functions\/v1\/manager-api(?:\/)?$/i.test(clean);
}

function apiBaseCandidates(preferred = "") {
  const currentOrigin = getCurrentOriginApiBase();
  return [
    preferred,
    ...(window.priceOfferDesktop?.serverCandidates || []),
    window.priceOfferDesktop?.apiBase,
    localStorage.getItem("priceOfferApiBase"),
    currentOrigin,
    DEFAULT_API_BASE,
    `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`,
    `http://localhost:${DEFAULT_LOCAL_PORT}`,
  ]
    .map(cleanApiBase)
    .filter(Boolean)
    .filter(isApiBaseUsableOnCurrentPage)
    .filter((value, index, all) => all.indexOf(value) === index);
}

async function probeApiBase(candidate) {
  const clean = cleanApiBase(candidate);
  if (!isApiBaseUsableOnCurrentPage(clean)) return "";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(buildUrl(clean, "/api/health"), {
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data?.app === APP_NAME ? clean : "";
  } catch {
    return "";
  } finally {
    window.clearTimeout(timer);
  }
}

async function discoverApiBase(preferred = "") {
  for (const candidate of apiBaseCandidates(preferred)) {
    const found = await probeApiBase(candidate);
    if (found) return found;
  }
  return "";
}

function fileNameFromDisposition(header, fallback) {
  const value = header || "";
  const utf = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) return decodeURIComponent(utf[1]);
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy path used by older webviews.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto 0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function hasSelectedTextInsideEditor(target) {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return (
      typeof target.selectionStart === "number" &&
      typeof target.selectionEnd === "number" &&
      target.selectionEnd > target.selectionStart
    );
  }
  const editor = target?.closest?.('[contenteditable="true"]');
  if (!editor) return false;
  const selection = window.getSelection?.();
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.toString().length > 0 &&
      editor.contains(selection.anchorNode) &&
      editor.contains(selection.focusNode),
  );
}

function performanceStart() {
  return globalThis.performance?.now?.() || Date.now();
}

function logDevelopmentPerformance(label, startedAt, metadata = "") {
  if (!import.meta.env.DEV) return;
  const elapsed = (globalThis.performance?.now?.() || Date.now()) - startedAt;
  const threshold = label.includes("draft") ? 2 : 8;
  if (elapsed < threshold) return;
  console.debug(
    `[Performance] ${label}: ${elapsed.toFixed(1)} ms${metadata ? ` (${metadata})` : ""}`,
  );
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

async function isNativeApp() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function saveNativeReport(blob, fileName, options = {}) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const data = await blobToBase64(blob);
  const directory = options.directory || Directory.Documents;
  const folder = options.folder || "Price offers";
  const result = await Filesystem.writeFile({
    path: `${folder}/${fileName}`,
    data,
    directory,
    recursive: true,
  });
  return result.uri;
}

async function shareNativeReport(blob, fileName) {
  const { Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const uri = await saveNativeReport(blob, fileName, {
    directory: Directory.Cache,
    folder: "Accounting Management Share",
  });
  try {
    await Share.share({
      title: fileName,
      text: fileName,
      files: [uri],
      dialogTitle: "Share report",
    });
  } catch (fileError) {
    await Share.share({
      title: fileName,
      text: fileName,
      url: uri,
      dialogTitle: "Share report",
    });
  }
  return uri;
}

const NATIVE_SETTINGS_PATH = "accounting-management-settings.json";

async function loadNativeSettings() {
  try {
    if (!(await isNativeApp())) return {};
    const { Filesystem, Directory, Encoding } =
      await import("@capacitor/filesystem");
    const result = await Filesystem.readFile({
      path: NATIVE_SETTINGS_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return JSON.parse(result.data || "{}");
  } catch {
    return {};
  }
}

async function saveNativeSettings(patch) {
  try {
    if (!(await isNativeApp())) return;
    const { Filesystem, Directory, Encoding } =
      await import("@capacitor/filesystem");
    const current = await loadNativeSettings();
    await Filesystem.writeFile({
      path: NATIVE_SETTINGS_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: JSON.stringify({ ...current, ...patch }),
    });
  } catch {
    // Native settings are a convenience cache; localStorage remains the fallback.
  }
}

function documentTypeMeta(value) {
  return (
    DOCUMENT_TYPES.find((item) => item.value === value) || DOCUMENT_TYPES[0]
  );
}

function noticeTypeFor(message) {
  const text = String(message || "").toLowerCase();
  if (
    /تعذر|فشل|خطأ|error|failed|failure|could not|cannot|invalid|not supported|no voice/.test(
      text,
    )
  )
    return "error";
  if (/تحذير|تنبيه|alert|warning|update.+available/.test(text))
    return "warning";
  return "success";
}

function NoticeItem({ notice, onClose }) {
  useEffect(() => {
    if (notice.sticky) return undefined;
    const timer = window.setTimeout(() => onClose(notice.id), 60_000);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.sticky, onClose]);
  return (
    <div className={`app-notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"} dir="auto">
      <span>{notice.text}</span>
      <button type="button" onClick={() => onClose(notice.id)} title="إغلاق التنبيه" aria-label="Close notification">
        <X size={16} />
      </button>
    </div>
  );
}

function NoticeCenter({ notices, onClose }) {
  if (!notices.length) return null;
  return (
    <div className="notice-center" aria-live="polite">
      {notices.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} onClose={onClose} />
      ))}
    </div>
  );
}

function SessionStatusChip({ user, online, now }) {
  if (!user) return null;
  const startedAt = user.session_started_at || user.last_seen_at || new Date().toISOString();
  const duration = compactDuration(now - new Date(startedAt).getTime());
  const statusText = online ? "متصل" : "غير متصل";
  return (
    <span
      className={`session-chip ${online ? "online" : "offline"}`}
      title={`المستخدم: ${user.display_name || user.username || "-"}\nبداية الجلسة: ${formatUserDateTime(startedAt)}\nمتصل منذ: ${duration}\nآخر ظهور: ${formatUserDateTime(user.last_seen_at)}`}
    >
      <span className="presence-dot" />
      <strong>{user.display_name || user.username}</strong>
      <small>{statusText} · {duration}</small>
    </span>
  );
}

function TermsGate({ onAccept }) {
  const [checked, setChecked] = useState(false);
  return (
    <main className="terms-gate" dir="ltr">
      <section className="terms-gate-panel">
        <div className="manager-brand">
          <AppBrandMark small />
          <div>
            <strong>Accounting Management</strong>
            <span>Service terms and cookie notice</span>
          </div>
        </div>
        <h1>Terms required before use</h1>
        <p>
          This app stores local business records, device/session data, cookies or
          local storage preferences, subscription status, and payment references
          needed to operate the service.
        </p>
        <div className="terms-gate-list">
          <span>Use is limited by the active subscription plan and user limit.</span>
          <span>Payment activation depends on backend PayPal verification and capture.</span>
          <span>Company admins are responsible for their users, reports, and exported files.</span>
          <span>Non-private operational data may be sent to the owner manager for support.</span>
        </div>
        <label className="check-tile">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>I agree to the service terms and cookie notice.</span>
        </label>
        <button
          type="button"
          className="primary"
          disabled={!checked}
          onClick={onAccept}
        >
          <Check size={18} /> Continue
        </button>
      </section>
    </main>
  );
}

function SubscriptionGateModal({ state, onClose, onSubscribe }) {
  if (!state?.status) return null;
  const blocked = state.can_use_app === false;
  const dateText =
    state.free_access_until ||
    state.subscription_expires_at ||
    state.trial_expires_at ||
    state.grace_expires_at ||
    "";
  return (
    <div className="subscription-gate-backdrop" role="dialog" aria-modal="true" dir="ltr">
      <section className={blocked ? "subscription-gate blocked" : "subscription-gate"}>
        <div className="subscription-gate-head">
          <span>{blocked ? "Subscription required" : "Subscription notice"}</span>
          {!blocked && (
            <button type="button" onClick={onClose} aria-label="Close">
              <X size={17} />
            </button>
          )}
        </div>
        <h2>
          {state.status === "free-access"
            ? "Free access"
            : state.status === "trial"
              ? "Trial period"
              : state.status === "grace"
                ? "Payment grace period"
                : "App access is paused"}
        </h2>
        <p>{state.message || "Subscribe to continue using Accounting Management."}</p>
        {dateText && <strong>{String(dateText).slice(0, 10)}</strong>}
        <button type="button" className="primary" onClick={onSubscribe}>
          <WalletCards size={18} /> Open subscription settings
        </button>
      </section>
    </div>
  );
}

function SubscriptionBlockedNotice({ state, onPay }) {
  const expiredAt =
    state?.expired_at ||
    state?.subscription_expires_at ||
    state?.trial_expires_at ||
    state?.free_access_until ||
    "";
  return (
    <section className="panel subscription-blocked-notice" dir="ltr">
      <div>
        <AlertTriangle size={22} />
        <span>App access is blocked</span>
      </div>
      <h2>Pay to continue using the app benefits</h2>
      <p>
        {state?.message ||
          "Payment is required before Accounting Management can be used again."}
      </p>
      {expiredAt && <strong>Expired: {String(expiredAt).slice(0, 10)}</strong>}
      <button type="button" className="primary" onClick={onPay}>
        <WalletCards size={18} /> Open payment control
      </button>
    </section>
  );
}

function mapRowToForm(row) {
  return {
    ...DEFAULT_ENTRY,
    ...row,
    entry_date: dateInputValue(row.entry_date || DEFAULT_ENTRY.entry_date),
    base_party_name: row.base_party_name || row.customer_name || "",
    customer_name: row.base_party_name || row.customer_name || "",
    document_type:
      row.accounting_status === "فاتورة"
        ? "invoice"
        : row.accounting_status === "مستخلص مقاول"
          ? "contractor_certificate"
          : "price_offer",
    party_role: row.party_role || "customer",
    party_category: row.party_category || "unselected",
    unit_code: row.unit_code || "sqm",
    measurement_mode: row.measurement_mode || "standard",
    document_status: row.document_status || "draft",
  };
}

function App() {
  const [apiBase, setApiBaseState] = useState(getInitialApiBase);
  const [showSplash, setShowSplash] = useState(true);
  const [themeMode, setThemeMode] = useState(
    localStorage.getItem("priceOfferTheme") || "system",
  );
  const [resolvedDark, setResolvedDark] = useState(false);
  const [activeTab, setActiveTab] = useState(INITIAL_ACTIVE_TAB);
  const [health, setHealth] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [lookups, setLookups] = useState({
    customers: [],
    contractors: [],
    projects: [],
    workTypes: [],
    units: UNITS,
  });
  const [terms, setTerms] = useState({
    terms_retail: { sections: [] },
    terms_corporate: { sections: [] },
  });
  const [reportBranding, setReportBranding] = useState(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [entryForm, setEntryForm] = useState(() => variantEntryDefaults());
  const [editingId, setEditingId] = useState(null);
  const [entryDirty, setEntryDirty] = useState(false);
  const [editorContext, setEditorContext] = useState(null);
  const [reportContexts, setReportContexts] = useState({});
  const [paymentFocus, setPaymentFocus] = useState(null);
  const [customerExplorerFocus, setCustomerExplorerFocus] = useState(null);
  const [notices, setNotices] = useState([]);
  const noticeCounterRef = useRef(0);
  const closeNotice = useCallback((id) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const setMessage = useCallback((value, options = {}) => {
    if (!value) {
      setNotices([]);
      return;
    }
    const text = String(value).trim().replace(/[.]+\s*$/, "");
    if (!text) return;
    const type = options.type || noticeTypeFor(text);
    const notice = {
      id: `${Date.now()}-${noticeCounterRef.current += 1}`,
      text,
      type,
      sticky: options.sticky ?? type !== "success",
    };
    setNotices((current) => [...current.slice(-4), notice]);
  }, []);
  useEffect(() => {
    const preventNativeNumberStep = (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "number" &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
      }
    };
    const preventNativeNumberWheel = (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "number" &&
        document.activeElement === event.target
      ) {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", preventNativeNumberStep, true);
    document.addEventListener("wheel", preventNativeNumberWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      document.removeEventListener("keydown", preventNativeNumberStep, true);
      document.removeEventListener("wheel", preventNativeNumberWheel, true);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      localStorage.removeItem("priceOfferUser");
      return userWithFreshSession(
        JSON.parse(sessionStorage.getItem("priceOfferUser") || "null"),
      );
    } catch {
      return null;
    }
  });
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine !== false);
  const [sessionNow, setSessionNow] = useState(() => Date.now());
  const [subscriptionState, setSubscriptionState] = useState(null);
  const [managerEvents, setManagerEvents] = useState([]);
  const notifiedManagerEventIdsRef = useRef(new Set());
  const [subscriptionModalVisible, setSubscriptionModalVisible] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(
    () => localStorage.getItem(SERVICE_TERMS_STORAGE_KEY) === SERVICE_TERMS_VERSION,
  );
  const [developerDataVisible, setDeveloperDataVisible] = useState(
    () => localStorage.getItem("priceOfferDeveloperDataVisible") === "1",
  );

  useEffect(() => {
    if (window.priceOfferDesktop?.startupWarning) {
      setMessage(window.priceOfferDesktop.startupWarning, {
        type: "warning",
        sticky: true,
      });
    }
  }, [setMessage]);

  useEffect(() => {
    const storedMode = localStorage.getItem("priceOfferConnectionMode");
    const connectionMode = connectionModeForApiBase(apiBase, storedMode || "");
    localStorage.setItem("priceOfferApiBase", cleanApiBase(apiBase));
    localStorage.setItem("priceOfferConnectionMode", connectionMode);
    window.priceOfferDesktop
      ?.updateDesktopSettings?.({
        serverUrl: cleanApiBase(apiBase),
        connectionMode,
      })
      .catch?.(() => {});
  }, []);

  useEffect(() => {
    if (!busy) restoreInputInteractivity();
  }, [busy]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setSessionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateOnline = () => {
      const online = navigator.onLine !== false;
      setNetworkOnline(online);
      setCurrentUser((user) =>
        user
          ? {
              ...user,
              is_online: online,
              last_seen_at: new Date().toISOString(),
            }
          : user,
      );
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    sessionStorage.setItem("priceOfferUser", JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    const rememberEditableFocus = (event) => {
      const target = event.target;
      if (isEditableFocusTarget(target) && !target.disabled && !target.readOnly) {
        lastEditableFocusTarget = target;
      }
    };
    const recoverTextFocus = (event) => {
      const target = event.target;
      if (!isEditableFocusTarget(target))
        return;
      if (target.disabled || target.readOnly) return;
      lastEditableFocusTarget = target;
      window.requestAnimationFrame(() => {
        if (!target.isConnected || target.disabled || target.readOnly) return;
        const active = document.activeElement;
        if (
          active &&
          active !== target &&
          active !== document.body &&
          active !== document.documentElement
        ) {
          return;
        }
        if (document.activeElement !== target) target.focus({ preventScroll: true });
      });
    };
    document.addEventListener("focusin", rememberEditableFocus, true);
    document.addEventListener("pointerdown", recoverTextFocus, true);
    return () => {
      document.removeEventListener("focusin", rememberEditableFocus, true);
      document.removeEventListener("pointerdown", recoverTextFocus, true);
    };
  }, []);

  useEffect(() => {
    const scrollNumberHost = (event, target) => {
      const host =
        target.closest?.(".smart-table-scroll, .table-scroll, .workspace") ||
        document.scrollingElement ||
        document.documentElement;
      if (!host) return;
      host.scrollTop += event.deltaY;
      host.scrollLeft += event.deltaX;
    };
    const stopNumberWheel = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "number")
        return;
      event.preventDefault();
      scrollNumberHost(event, target);
    };
    document.addEventListener("wheel", stopNumberWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      document.removeEventListener("wheel", stopNumberWheel, { capture: true });
  }, []);

  useEffect(() => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "global-input-clear";
    button.textContent = "X";
    button.title = "Clear";
    button.setAttribute("aria-label", "Clear input");
    document.body.appendChild(button);
    let activeField = null;
    const textInputTypes = new Set([
      "",
      "date",
      "datetime-local",
      "email",
      "month",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ]);
    const canClear = (target) => {
      if (
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        )
      )
        return false;
      if (target.disabled || target.readOnly) return false;
      if (target instanceof HTMLInputElement && !textInputTypes.has(target.type))
        return false;
      return String(target.value || "").length > 0;
    };
    const hide = () => {
      activeField = null;
      button.classList.remove("visible");
    };
    const position = () => {
      if (!activeField || !canClear(activeField)) {
        hide();
        return;
      }
      const rect = activeField.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        hide();
        return;
      }
      const dir = getComputedStyle(activeField).direction;
      const buttonSize = 20;
      button.style.top = `${rect.top + Math.max(0, (rect.height - buttonSize) / 2)}px`;
      button.style.left =
        dir === "rtl"
          ? `${rect.left + 10}px`
          : `${rect.right - buttonSize - 10}px`;
      button.classList.add("visible");
    };
    const focusIn = (event) => {
      activeField = event.target;
      window.requestAnimationFrame(position);
    };
    const update = (event) => {
      if (event.target === activeField) window.requestAnimationFrame(position);
    };
    const clear = (event) => {
      event.preventDefault();
      if (!activeField) return;
      const proto =
        activeField instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      descriptor?.set?.call(activeField, "");
      activeField.dispatchEvent(new Event("input", { bubbles: true }));
      activeField.dispatchEvent(new Event("change", { bubbles: true }));
      activeField.focus({ preventScroll: true });
      hide();
    };
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("input", update, true);
    document.addEventListener("change", update, true);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    button.addEventListener("pointerdown", clear);
    return () => {
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("input", update, true);
      document.removeEventListener("change", update, true);
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      button.removeEventListener("pointerdown", clear);
      button.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreNativeSettings() {
      const settings = await loadNativeSettings();
      if (cancelled) return;
      if (settings.apiBase) {
        const clean = cleanApiBase(settings.apiBase);
        if (isApiBaseUsableOnCurrentPage(clean)) {
          setApiBaseState(clean);
          localStorage.setItem("priceOfferApiBase", clean);
        } else if (clean) {
          localStorage.removeItem("priceOfferApiBase");
        }
      }
      if (
        settings.lastUsername &&
        !localStorage.getItem("priceOfferLastUsername")
      ) {
        localStorage.setItem("priceOfferLastUsername", settings.lastUsername);
      }
    }
    restoreNativeSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = APP_VARIANT.name;
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "priceOfferDeveloperDataVisible",
      developerDataVisible ? "1" : "0",
    );
  }, [developerDataVisible]);

  useEffect(() => {
    const applyTheme = () => {
      const mode = ["system", "light", "dark", "gold"].includes(themeMode)
        ? themeMode
        : "system";
      const dark =
        mode === "dark" ||
        (mode === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      const resolvedTheme = mode === "gold" ? "gold" : dark ? "dark" : "light";
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.style.colorScheme =
        resolvedTheme === "light" ? "light" : "dark";
      setResolvedDark(resolvedTheme !== "light");
    };
    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", applyTheme);
    localStorage.setItem("priceOfferTheme", themeMode);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [themeMode]);

  const api = useMemo(
    () => ({
      async request(path, options = {}) {
        let response;
        try {
          response = await fetch(buildUrl(apiBase, path), {
            ...options,
            headers: {
              ...(options.body ? { "Content-Type": "application/json" } : {}),
              ...(options.headers || {}),
            },
          });
        } catch (fetchError) {
          fetchError.isNetworkError = true;
          throw fetchError;
        }
        let raw = "";
        let data = null;
        try {
          raw = await response.text();
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = null;
            }
          }
        } catch {
          raw = "";
        }
        if (!response.ok) {
          let details = data?.error || data?.message || "";
          if (!details && raw) {
            details = /^<!doctype html>|^<html[\s>]/i.test(raw.trim())
              ? `HTTP ${response.status}`
              : raw;
          }
          const error = new Error(details || `HTTP ${response.status}`);
          error.status = response.status;
          error.payload = data;
          error.isNetworkError = false;
          if (
            response.status === 402 &&
            (data?.payment_required || data?.can_use_app === false)
          ) {
            error.paymentRequired = true;
            setSubscriptionState(data);
            setSubscriptionModalVisible(false);
            setActiveTab("settings");
          }
          throw error;
        }
        return data ?? {};
      },
    }),
    [apiBase],
  );

  const companyHeaderLogo = reportBranding?.logoDataUri || appLogo;

  const updatePlatform = useMemo(() => {
    if (window.priceOfferDesktop?.platform)
      return window.priceOfferDesktop.platform;
    if (/android/i.test(navigator.userAgent)) return "android";
    if (/windows/i.test(navigator.userAgent)) return "win32";
    return "web";
  }, []);

  const developerDataItems = useMemo(
    () =>
      [
        ["API", apiBase],
        ["Installed Version", APP_VERSION],
        ["Server Version", health?.serverVersion || health?.version],
        ["DB Schema", health?.databaseSchemaVersion],
        ["Backend", health?.backend || "local-server"],
        ["Port", health?.port],
        ["Data", health?.dataDir],
        ["DB", health?.dbPath],
        ["View", activeTab],
      ].filter(([, value]) => value !== undefined && value !== null && value !== ""),
    [activeTab, apiBase, health],
  );

  function renderDeveloperDataStrip() {
    if (!developerDataVisible) return null;
    return (
      <div className="developer-data-strip" dir="ltr">
        {developerDataItems.map(([label, value]) => (
          <span key={label} title={`${label}: ${value}`}>
            <strong>{label}</strong>
            <code>{String(value)}</code>
          </span>
        ))}
      </div>
    );
  }

  const checkForUpdates = useCallback(
    async (silent = true) => {
      setCheckingUpdate(true);
      const currentVersion = APP_VERSION;
      const normalizeVersion = (value) => {
        const clean = String(value || currentVersion || "0.0.0").replace(
          /^v/i,
          "",
        );
        return `v${clean}`;
      };
      try {
        const data = window.priceOfferDesktop?.checkForUpdates
          ? await window.priceOfferDesktop.checkForUpdates()
          : await api.request(
              `/api/update/latest?platform=${encodeURIComponent(updatePlatform)}&installed_version=${encodeURIComponent(APP_VERSION)}`,
            );
        const normalized = {
          ...data,
          installedVersion: normalizeVersion(APP_VERSION),
          currentVersion: normalizeVersion(APP_VERSION),
          latestVersion: data.latestVersion
            ? normalizeVersion(data.latestVersion)
            : "",
        };
        setUpdateInfo(normalized);
        if (!silent && !normalized.updateAvailable) {
          setMessage(
            `Accounting Management is up to date (${normalized.currentVersion}).`,
          );
        }
        return normalized;
      } catch (error) {
        setUpdateInfo({
          status: "error",
          updateAvailable: false,
          currentVersion: normalizeVersion(currentVersion),
          error: error.message,
        });
        if (!silent) setMessage(`تعذر فحص التحديثات: ${error.message}`);
        return null;
      } finally {
        setCheckingUpdate(false);
      }
    },
    [api, updatePlatform],
  );

  const refreshAll = useCallback(async (options = {}) => {
    const {
      showBusy = true,
      clearNotice = true,
      includeSubscription = true,
    } = options;
    if (showBusy) setBusy(true);
    if (clearNotice) setMessage("");
    try {
      const [
        healthData,
        bootstrapData,
        lookupData,
        termsData,
        brandingData,
        plansData,
        subscriptionStatus,
      ] = await Promise.all([
        api.request("/api/health"),
        api.request("/api/bootstrap"),
        api.request("/api/lookups"),
        api.request("/api/settings/terms").catch(() => ({
          terms_retail: { sections: [] },
          terms_corporate: { sections: [] },
        })),
        api.request("/api/settings/report-branding").catch(() => null),
        api.request("/api/subscription/plans").catch(() => ({ plans: [] })),
        includeSubscription
          ? api.request("/api/subscription/status").catch(() => null)
          : Promise.resolve(null),
      ]);
      if (subscriptionStatus) {
        setSubscriptionState({
          ...subscriptionStatus,
          can_use_app:
            subscriptionStatus.can_use_app !== false &&
            subscriptionStatus.has_access !== false,
        });
        if (
          subscriptionStatus.can_use_app === false ||
          subscriptionStatus.has_access === false
        ) {
          setSubscriptionModalVisible(false);
          setActiveTab("settings");
        }
      }
      setHealth({
        ...healthData,
        app: APP_NAME,
        version: healthData.version || APP_VERSION,
        backend: healthData.backend || "local-server",
      });
      setBootstrap(bootstrapData);
      setLookups({
        customers: [],
        contractors: [],
        projects: [],
        workTypes: [],
        units: UNITS,
        ...(lookupData || {}),
      });
      setTerms({
        terms_retail: { sections: [] },
        terms_corporate: { sections: [] },
        ...(termsData || {}),
      });
      setReportBranding(brandingData);
      setSubscriptionPlans(plansData?.plans || []);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setHealth(null);
      setMessage(`تعذر الاتصال بالسيرفر المحلي: ${error.message}`);
    } finally {
      if (showBusy) setBusy(false);
      restoreInputInteractivity();
    }
  }, [api]);

  const refreshLocalData = useCallback(
    () =>
      refreshAll({
        showBusy: false,
        clearNotice: false,
        includeSubscription: false,
      }),
    [refreshAll],
  );

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    const checkSubscriptionAccess = () => {
      api.request("/api/subscription/status")
        .then((status) => {
          if (cancelled || !status) return;
          setSubscriptionState({
            ...status,
            can_use_app: status.can_use_app !== false && status.has_access !== false,
          });
          if (status.can_use_app === false || status.has_access === false) {
            setSubscriptionModalVisible(false);
            setActiveTab("settings");
          }
        })
        .catch(() => {});
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkSubscriptionAccess();
    };
    checkSubscriptionAccess();
    const timer = window.setInterval(checkSubscriptionAccess, 60 * 1000);
    window.addEventListener("focus", checkSubscriptionAccess);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkSubscriptionAccess);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [api, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) {
      setManagerEvents([]);
      return undefined;
    }
    let cancelled = false;
    const loadEvents = async () => {
      try {
        const query = new URLSearchParams({
          user_id: String(currentUser.id),
          username: currentUser.username || currentUser.display_name || "",
          company: bootstrap?.company?.company_name || "",
        });
        const data = await api.request(`/api/events?${query.toString()}`);
        const events = data?.events || [];
        if (cancelled) return;
        setManagerEvents(events.filter((event) => event.in_app_enabled));
        for (const event of events.filter((item) => item.windows_enabled)) {
          if (event.notified || notifiedManagerEventIdsRef.current.has(event.id)) {
            continue;
          }
          notifiedManagerEventIdsRef.current.add(event.id);
          if (window.priceOfferDesktop?.showNotification) {
            await window.priceOfferDesktop.showNotification({
              title: event.title,
              body: event.message,
              section: "settings",
            });
          } else if ("Notification" in window) {
            if (Notification.permission === "default") {
              await Notification.requestPermission().catch(() => "denied");
            }
            if (Notification.permission === "granted") {
              new Notification(event.title, { body: event.message });
            }
          }
          await api.request(`/api/events/${event.id}/notified`, {
            method: "POST",
            body: JSON.stringify({ user_id: currentUser.id }),
          }).catch(() => null);
        }
      } catch {
        if (!cancelled) setManagerEvents([]);
      }
    };
    loadEvents();
    const timer = window.setInterval(loadEvents, 60 * 1000);
    const onFocus = () => loadEvents();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [
    api,
    bootstrap?.company?.company_name,
    currentUser?.display_name,
    currentUser?.id,
    currentUser?.username,
  ]);

  useEffect(() => {
    if (!currentUser) return undefined;
    if (window.priceOfferDesktop?.getUpdateState) {
      let cancelled = false;
      const normalizeDesktopState = (state = {}) => {
        const normalize = (value) =>
          `v${String(value || APP_VERSION).replace(/^v/i, "")}`;
        return {
          ...state,
          installedVersion: normalize(APP_VERSION),
          currentVersion: normalize(APP_VERSION),
          latestVersion: state.latestVersion ? normalize(state.latestVersion) : "",
        };
      };
      window.priceOfferDesktop.getUpdateState().then((state) => {
        if (!cancelled) setUpdateInfo(normalizeDesktopState(state));
      }).catch(() => null);
      const unsubscribe = window.priceOfferDesktop.onUpdateState?.((state) => {
        if (cancelled) return;
        const normalized = normalizeDesktopState(state);
        setUpdateInfo(normalized);
        setCheckingUpdate(normalized.status === "checking");
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }
    checkForUpdates(true);
    const timer = window.setInterval(
      () => checkForUpdates(true),
      6 * 60 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [currentUser?.id, checkForUpdates]);

  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const sessionStartedAt =
      currentUser.session_started_at || new Date().toISOString();
    const buildPresencePayload = (event = "presence") => {
      const now = new Date();
      const onlineForSeconds = Math.max(
        0,
        Math.floor((now.getTime() - new Date(sessionStartedAt).getTime()) / 1000),
      );
      return {
        summary: "Accounting Management presence",
        app: {
          name: APP_NAME,
          version: APP_VERSION,
          release_label: `v${APP_DISPLAY_VERSION}`,
          variant: APP_VARIANT_ID,
          platform: updatePlatform,
        },
        users: [
          {
            id: currentUser.id,
            username: currentUser.username,
            display_name: currentUser.display_name,
            role: currentUser.role,
            is_online: event !== "offline" && networkOnline,
            session_started_at: sessionStartedAt,
            online_for_seconds: onlineForSeconds,
            last_seen_at: now.toISOString(),
          },
        ],
        meta: {
          event,
          session_started_at: sessionStartedAt,
          online_for_seconds: onlineForSeconds,
          network_online: networkOnline,
        },
      };
    };
    const ping = () => {
      api.request(`/api/users/${currentUser.id}/presence`, {
        method: "POST",
        body: JSON.stringify(buildPresencePayload(networkOnline ? "presence" : "offline")),
      })
        .then((data) => {
          if (data?.user) {
            setCurrentUser((user) =>
              user && user.id === data.user.id ? userWithFreshSession(data.user) : user,
            );
          }
        })
        .catch(() => {});
    };
    ping();
    const timer = window.setInterval(ping, 45 * 1000);
    const markOffline = () => {
      api.request("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({
          user_id: currentUser.id,
          ...buildPresencePayload("offline"),
        }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", markOffline);
    window.addEventListener("beforeunload", markOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", markOffline);
      window.removeEventListener("beforeunload", markOffline);
      markOffline();
    };
  }, [
    currentUser?.display_name,
    currentUser?.id,
    currentUser?.role,
    currentUser?.session_started_at,
    currentUser?.username,
    api,
    networkOnline,
    updatePlatform,
  ]);

  useEffect(() => {
    if (!currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get("payment_id");
    const orderId = params.get("token") || params.get("paypal_order_id");
    if (!paymentId && !orderId) return;
    const captureKey = `paypalCapture:${paymentId || "paypal"}:${orderId || "return"}`;
    if (sessionStorage.getItem(captureKey)) return;
    sessionStorage.setItem(captureKey, "1");
    api.request("/api/subscription/status")
      .then((status) => {
        setSubscriptionState({
          ...status,
          can_use_app: status.can_use_app !== false && status.has_access !== false,
        });
        setMessage("تم تحديث حالة الاشتراك من السيرفر المحلي.", {
          type: "success",
        });
      })
      .catch((error) => {
        setMessage(`تعذر تحديث حالة الاشتراك: ${error.message}`);
      });
  }, [api, currentUser?.id, setMessage]);

  useEffect(() => {
    if (!currentUser || !subscriptionState?.status) return;
    if (subscriptionState.status === "owner-local" || subscriptionState.status === "active")
      return;
    if (subscriptionState.can_use_app === false) {
      setSubscriptionModalVisible(true);
      setActiveTab("settings");
      return;
    }
    const key = `subscriptionNotice:${subscriptionState.status}`;
    const last = Number(localStorage.getItem(key) || 0);
    const intervalMs =
      Number(subscriptionState.reminder_interval_hours || 8) * 60 * 60 * 1000;
    if (Date.now() - last > intervalMs) {
      localStorage.setItem(key, String(Date.now()));
      setSubscriptionModalVisible(true);
    }
  }, [currentUser?.id, subscriptionState?.status, subscriptionState?.can_use_app]);

  async function openUpdateDownload() {
    if (window.priceOfferDesktop?.installUpdate) {
      if (updateInfo?.canInstall) {
        setMessage("سيتم إغلاق التطبيق وتثبيت التحديث الذي تم تنزيله.");
        await window.priceOfferDesktop.installUpdate();
        return;
      }
      if (["available", "downloading"].includes(updateInfo?.status)) {
        setMessage(
          updateInfo?.status === "downloading"
            ? `جاري تنزيل التحديث (${Math.round(updateInfo.downloadPercent || 0)}%).`
            : "تم العثور على التحديث وبدأ تنزيله. سيظهر زر إعادة التشغيل بعد اكتمال التنزيل.",
        );
        return;
      }
      await checkForUpdates(false);
      return;
    }
    const info = updateInfo?.downloadUrl
      ? updateInfo
      : await checkForUpdates(false);
    const url = info?.downloadUrl || info?.releaseUrl;
    if (!url) return;
    if (window.priceOfferDesktop?.openExternal) {
      window.priceOfferDesktop.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setMessage(
      `Update ${info.latestVersion || ""} is opening for download. Run the downloaded installer/APK to complete installation.`,
    );
  }

  function setApiBase(value, options = {}) {
    const clean = safeApiBaseForCurrentPage(value, apiBase || DEFAULT_API_BASE);
    const connectionMode = connectionModeForApiBase(
      clean,
      options.connectionMode || "",
    );
    setApiBaseState(clean);
    localStorage.setItem("priceOfferApiBase", clean);
    localStorage.setItem("priceOfferConnectionMode", connectionMode);
    window.priceOfferDesktop
      ?.updateDesktopSettings?.({ serverUrl: clean, connectionMode })
      .catch?.(() => {});
    saveNativeSettings({ apiBase: clean, connectionMode });
  }

  function cycleThemeMode() {
    const modes = ["system", "light", "dark", "gold"];
    const next = modes[(modes.indexOf(themeMode) + 1) % modes.length] || "system";
    setThemeMode(next);
  }

  async function updateManagerEventState(eventId, action) {
    if (!currentUser?.id) return;
    try {
      await api.request(`/api/events/${eventId}/${action}`, {
        method: "POST",
        body: JSON.stringify({ user_id: currentUser.id }),
      });
      if (action === "dismiss") {
        setManagerEvents((current) =>
          current.filter((event) => Number(event.id) !== Number(eventId)),
        );
      } else {
        setManagerEvents((current) =>
          current.map((event) =>
            Number(event.id) === Number(eventId)
              ? { ...event, seen: true }
              : event,
          ),
        );
      }
    } finally {
      restoreInputInteractivity();
    }
  }

  function focusSubscriptionPanel() {
    setActiveTab("settings");
    window.setTimeout(() => {
      document
        .querySelector(".subscription-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function login(credentials, explicitApiBase = "") {
    setBusy(true);
    const loginApiBase = safeApiBaseForCurrentPage(
      explicitApiBase || credentials.apiBase || apiBase,
      apiBase || DEFAULT_API_BASE,
    );
    try {
      const response = await fetch(buildUrl(loginApiBase, "/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
      }
      const user = userWithFreshSession(data.user);
      if (loginApiBase !== apiBase) setApiBase(loginApiBase);
      setCurrentUser(user);
      if (data.company) {
        setBootstrap((current) => ({
          ...(current || {}),
          company: data.company,
        }));
      }
      if (data.subscription) {
        setSubscriptionState({
          ...data.subscription,
          can_use_app:
            data.subscription.can_use_app !== false &&
            data.subscription.has_access !== false,
        });
      }
      sessionStorage.setItem("priceOfferUser", JSON.stringify(user));
      localStorage.setItem("priceOfferLastUsername", credentials.username || "");
      if (credentials.company_name) {
        localStorage.setItem("priceOfferLastCompany", credentials.company_name || "");
      }
      saveNativeSettings({
        apiBase: loginApiBase,
        lastUsername: credentials.username || "",
      });
      setMessage(`تم تسجيل الدخول: ${user.display_name}`);
      if (loginApiBase === apiBase) await refreshAll();
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  async function createAccount(draft) {
    setBusy(true);
    try {
      const payload = {
        ...draft,
        local_port: draft.local_port || draft.port || "",
        data_folder: draft.data_folder || draft.dataDir || "",
      };
      const data = await api.request("/api/company/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const connectionMode =
        localStorage.getItem("priceOfferConnectionMode") ||
        window.priceOfferDesktop?.connectionMode ||
        connectionModeForApiBase(apiBase);
      if (
        connectionMode !== "remote" &&
        (data.server?.serverUrl || data.server?.localUrl)
      ) {
        setApiBase(data.server.serverUrl || data.server.localUrl, {
          connectionMode: "local",
        });
      }
      setBootstrap((current) => ({
        ...(current || {}),
        company: data.company || current?.company,
      }));
      setMessage(
        connectionMode === "remote"
          ? "Company account created through the configured remote server."
          : "Company account created on the local server.",
      );
      return { ...data, message: "Company account created. You can log in now." };
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  async function logout() {
    if (currentUser?.id) {
      const now = new Date();
      const sessionStartedAt =
        currentUser.session_started_at || now.toISOString();
      api.request("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({
          user_id: currentUser.id,
          summary: "Accounting Management logout",
          session_started_at: sessionStartedAt,
          session_ended_at: now.toISOString(),
        }),
      }).catch(() => {});
    }
    setCurrentUser(null);
    setSubscriptionState(null);
    setSubscriptionModalVisible(false);
    localStorage.removeItem("priceOfferUser");
    sessionStorage.removeItem("priceOfferUser");
    setMessage("");
    restoreInputInteractivity();
  }

  function requestTabChange(nextTab) {
    if (subscriptionState?.can_use_app === false && nextTab !== "settings") {
      setSubscriptionModalVisible(true);
      setActiveTab("settings");
      return;
    }
    if (
      APP_VARIANT.allowedTabs &&
      !APP_VARIANT.allowedTabs.includes(nextTab)
    )
      return;
    // The entry editor stays mounted while another section is open. Navigation
    // must never discard an in-progress document; replacement actions are
    // guarded separately where another document/new draft is actually opened.
    setActiveTab(nextTab);
  }

  useEffect(() => {
    const unsubscribe = window.priceOfferDesktop?.onNavigate?.((section) => {
      if (typeof section !== "string") return;
      requestTabChange(section);
    });
    return () => unsubscribe?.();
  }, [subscriptionState?.can_use_app]);

  function updateEntryForm(next) {
    setEntryDirty(true);
    setEntryForm((current) =>
      typeof next === "function" ? next(current) : next,
    );
  }

  function updateReportContext(workflowId, patch) {
    setReportContexts((current) => ({
      ...current,
      [workflowId]: {
        ...(current[workflowId] || {}),
        ...patch,
      },
    }));
  }

  function switchToTab(tabId) {
    if (!APP_VARIANT.allowedTabs || APP_VARIANT.allowedTabs.includes(tabId))
      setActiveTab(tabId);
    else setActiveTab(APP_VARIANT.defaultTab);
  }

  async function openDocumentPreview(doc, party) {
    if (!doc?.id) return;
    const workflowId = workflowForDocument(doc);
    const workflow = WORKFLOWS[workflowId];
    const partyObject = party || {
      id: doc.party_id,
      display_name: doc.customer_name || doc.display_name || "",
      base_name: doc.base_name || doc.customer_name || doc.display_name || "",
      category: doc.category || "",
    };
    const query = new URLSearchParams();
    if (doc.document_type === "statement") {
      if (partyObject?.id) query.set("party_id", partyObject.id);
      if (doc.project) query.set("project", doc.project);
    } else {
      query.set("document_id", String(doc.id));
    }
    if (currentUser?.display_name)
      query.set("user_name", currentUser.display_name);
    const reportData = await api.request(
      `/api/documents/${workflow.reportType}?${query.toString()}`,
    );
    const previewUrl = buildUrl(
      apiBase,
      `/api/documents/${workflow.reportType}/html?${query.toString()}`,
    );
    updateReportContext(workflowId, {
      workflowId,
      party: partyObject,
      document: doc.document_type === "statement" ? null : doc,
      partySearch:
        partyObject?.display_name ||
        partyObject?.base_name ||
        doc.customer_name ||
        "",
      partyId: partyObject?.id ? String(partyObject.id) : "",
      documentSearch:
        doc.document_type === "statement" ? "" : documentOptionText(doc),
      documentId: doc.document_type === "statement" ? "" : String(doc.id),
      documents: doc.document_type === "statement" ? [] : [doc],
      projectFilter: doc.project || "",
      reportData,
      previewUrl,
      previewKey: `${workflow.reportType}?${query.toString()}`,
    });
    switchToTab(workflowId);
    setMessage(
      `Preview opened for ${doc.operation_no || doc.document_no || doc.id}.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshContextReport(context = editorContext) {
    if (!context?.workflowId) return;
    const workflow = WORKFLOWS[context.workflowId];
    if (!workflow) return;
    const query = new URLSearchParams();
    if (context.document?.id) query.set("document_id", context.document.id);
    else if (context.party?.id) query.set("party_id", context.party.id);
    if (!query.toString()) return;
    try {
      const data = await api.request(
        `/api/documents/${workflow.reportType}?${query.toString()}`,
      );
      const nextContext = { ...context, reportData: data };
      setEditorContext(nextContext);
      updateReportContext(context.workflowId, { reportData: data });
    } catch {
      // Keep editing responsive even if the preview refresh fails.
    }
  }

  function workflowForDocument(doc = {}) {
    if (doc.document_type === "statement") return "statement";
    if (
      doc.document_type === "invoice" ||
      (doc.document_type === "price_offer" && doc.status === "approved")
    )
      return "invoice";
    if (doc.document_type === "contractor_certificate") return "contractor";
    return "offer";
  }

  async function openCustomerDocument(doc, party) {
    if (!doc?.id) return;
    if (
      entryDirty &&
      !window.confirm(
        "تحذير: فتح هذا المستند سيستبدل الإدخال غير المحفوظ الحالي. هل تريد المتابعة؟",
      )
    )
      return;

    if (
      doc.document_type === "price_offer" ||
      doc.document_type === "invoice" ||
      doc.document_type === "contractor_certificate"
    ) {
      const workflowId = workflowForDocument(doc);
      const workflow = WORKFLOWS[workflowId];
      const partyObject = party || {
        id: doc.party_id,
        display_name: doc.customer_name,
        base_name: "",
      };
      const query = new URLSearchParams({ document_id: String(doc.id) });
      if (currentUser?.display_name)
        query.set("user_name", currentUser.display_name);
      setBusy(true);
      try {
        let reportData = await api.request(
          `/api/documents/${workflow.reportType}?${query.toString()}`,
        );
        if (!(reportData.rows || []).length) {
          const candidates = [
            doc.operation_no,
            doc.document_no,
            doc.id,
          ]
            .filter(Boolean)
            .map(String);
          for (const candidate of [...new Set(candidates)]) {
            const retryQuery = new URLSearchParams({ document_id: candidate });
            if (currentUser?.display_name)
              retryQuery.set("user_name", currentUser.display_name);
            const retry = await api.request(
              `/api/documents/${workflow.reportType}?${retryQuery.toString()}`,
            );
            if ((retry.rows || []).length) {
              reportData = retry;
              break;
            }
          }
        }
        const firstRow = reportData.rows?.[0] || {};
        const taxFlags = TAXES.reduce((flags, tax) => {
          flags[tax.key] = (reportData.rows || []).some(
            (row) => !!row[tax.key],
          );
          return flags;
        }, {});
        taxFlags.vat_terms_only = (reportData.rows || []).some(
          (row) => !!row.vat_terms_only,
        );
        const baseName =
          partyObject.base_name ||
          firstRow.base_party_name ||
          firstRow.customer_name ||
          doc.customer_name ||
          "";
        const displayName =
          partyObject.display_name ||
          firstRow.customer_display_name ||
          firstRow.customer_name ||
          baseName;
        const fixedBuilding =
          doc.building_unit ||
          reportData.building_unit ||
          firstRow.building_unit ||
          "";
        setEntryForm({
          ...DEFAULT_ENTRY,
          ...taxFlags,
          party_role: workflow.partyRole,
          party_category:
            doc.party_category ||
            firstRow.party_category ||
            partyObject.category ||
            "unselected",
          base_party_name: baseName,
          customer_name: baseName,
          customer_display_name: displayName,
          party_id: partyObject.id || firstRow.party_id || doc.party_id || "",
          source_customer_id: firstRow.source_customer_id || "",
          source_customer_name: firstRow.source_customer_name || "",
          document_id: doc.id,
          document_type: doc.document_type,
          document_status:
            doc.status || firstRow.document_status || workflow.defaultStatus,
          serial: doc.document_no || firstRow.serial || "",
          operation_no:
            doc.operation_no || firstRow.operation_no || doc.document_no || "",
          project: doc.project || reportData.project || firstRow.project || "",
          building_unit: fixedBuilding,
          floor_apartment:
            doc.floor_apartment || firstRow.floor_apartment || "",
          work_type: reportData.overall_work_type || firstRow.work_type || "",
          work_types: uniqueValues((reportData.rows || []).map((row) => row.work_type)),
          certificate_no: firstRow.certificate_no || "",
          entry_date: dateInputValue(
            doc.entry_date ||
              reportData.entry_date ||
              firstRow.entry_date ||
              DEFAULT_ENTRY.entry_date,
          ),
          discount_type:
            doc.discount_type || firstRow.discount_type || "none",
          discount_value: doc.discount_value ?? firstRow.discount_value ?? "",
        });
        const context = {
          workflowId,
          party: { ...partyObject, base_name: baseName, display_name: displayName },
          document: doc,
          reportData,
        };
        setEditingId(null);
        setEditorContext(context);
        updateReportContext(workflowId, {
          workflowId,
          party: context.party,
          document: doc,
          partySearch: displayName || baseName,
          partyId: context.party?.id ? String(context.party.id) : "",
          documentSearch: documentOptionText(doc),
          documentId: String(doc.id),
          documents: [doc],
          reportData,
        });
        setEntryDirty(false);
        setActiveTab(
          doc.document_type === "contractor_certificate"
            ? "contractor"
            : "entry",
        );
        setMessage(
          `تم فتح ${documentTypeLabel(doc.document_type)} ${doc.operation_no || doc.document_no || ""} للتعديل.`,
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (error) {
        setMessage(`تعذر فتح المستند للتعديل: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (doc.document_type === "statement") {
      const workflowId = "statement";
      const workflow = WORKFLOWS[workflowId];
      const partyObject = party || {
        id: doc.party_id,
        display_name: doc.customer_name,
        base_name: doc.customer_name,
      };
      const query = new URLSearchParams();
      if (partyObject?.id) query.set("party_id", partyObject.id);
      if (doc.project) query.set("project", doc.project);
      if (currentUser?.display_name)
        query.set("user_name", currentUser.display_name);
      setBusy(true);
      try {
        const reportData = await api.request(
          `/api/documents/${workflow.reportType}?${query.toString()}`,
        );
        updateReportContext(workflowId, {
          workflowId,
          party: partyObject,
          document: null,
          partySearch:
            partyObject?.display_name || partyObject?.base_name || "",
          partyId: partyObject?.id ? String(partyObject.id) : "",
          documentId: "",
          documents: [],
          reportData,
        });
        setActiveTab("statement");
        setMessage(
          `تم فتح كشف حساب ${doc.project || "عام"} للمعاينة والتصدير.`,
        );
      } catch (error) {
        setMessage(`تعذر فتح كشف الحساب: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (doc.document_type === "payment") {
      setPaymentFocus({
        party,
        project: doc.project || "",
        building_unit: doc.building_unit || "",
        paymentDocumentId: doc.id,
      });
      setActiveTab("payments");
      setMessage("تم فتح الدفعات لهذا العميل للمراجعة والتعديل.");
      return;
    }
    const workflowId = workflowForDocument(doc);
    const workflow = WORKFLOWS[workflowId];
    setBusy(true);
    try {
      const reportData = await api.request(
        `/api/documents/${workflow.reportType}?document_id=${doc.id}${currentUser?.display_name ? `&user_name=${encodeURIComponent(currentUser.display_name)}` : ""}`,
      );
      const partyObject = party || {
        id: doc.party_id,
        display_name: doc.customer_name,
        base_name: doc.customer_name,
      };
      const context = {
        workflowId,
        party: partyObject,
        document: doc,
        reportData,
      };
      setEditorContext(context);
      updateReportContext(workflowId, {
        workflowId,
        party: partyObject,
        document: doc,
        partySearch: partyObject?.display_name || partyObject?.base_name || "",
        partyId: partyObject?.id ? String(partyObject.id) : "",
        documentId: String(doc.id),
        documents: [doc],
        reportData,
      });
      setEntryDirty(false);
      setActiveTab("entry");
      setMessage(
        `تم فتح ${documentTypeLabel(doc.document_type)} ${doc.operation_no || doc.document_no || ""} للتعديل.`,
      );
    } catch (error) {
      setMessage(`تعذر فتح المستند للتعديل: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyDocumentAsNew(doc, party, loadedReport = null) {
    if (!doc?.id) return;
    if (
      entryDirty &&
      !window.confirm(
        "تحذير: نسخ المستند سيستبدل الإدخال غير المحفوظ الحالي. هل تريد المتابعة؟",
      )
    )
      return;
    const workflowId = workflowForDocument(doc);
    const workflow = WORKFLOWS[workflowId];
    setBusy(true);
    try {
      let reportData = loadedReport;
      if (!reportData?.rows?.length) {
        const query = new URLSearchParams({ document_id: String(doc.id) });
        reportData = await api.request(
          `/api/documents/${workflow.reportType}?${query.toString()}`,
        );
      }
      const rows = reportData?.rows || [];
      if (!rows.length) throw new Error("لا توجد بنود قابلة للنسخ في المستند المحدد");
      const firstRow = rows[0];
      const sourceType = doc.document_type || firstRow.document_type || "price_offer";
      const sourceMeta = documentTypeMeta(sourceType);
      const workTypes = uniqueValues(rows.map((row) => row.work_type));
      const partyObject = party || {
        id: doc.party_id || firstRow.party_id,
        base_name: firstRow.base_party_name || doc.customer_name,
        display_name: doc.customer_name || firstRow.customer_display_name,
        category: doc.party_category || firstRow.party_category,
      };
      setEntryForm({
        ...DEFAULT_ENTRY,
        party_role: sourceMeta.role,
        party_category: partyObject.category || firstRow.party_category || "unselected",
        party_id: partyObject.id || firstRow.party_id || "",
        base_party_name:
          partyObject.base_name || firstRow.base_party_name || doc.customer_name || "",
        customer_name:
          partyObject.base_name || firstRow.base_party_name || doc.customer_name || "",
        customer_display_name:
          partyObject.display_name || firstRow.customer_display_name || doc.customer_name || "",
        source_customer_id: firstRow.source_customer_id || "",
        source_customer_name: firstRow.source_customer_name || "",
        document_type: sourceType,
        document_status: sourceMeta.status,
        document_id: "",
        serial: "",
        operation_no: "",
        project: doc.project || reportData.project || firstRow.project || "",
        building_unit: doc.building_unit || reportData.building_unit || "",
        entry_date: new Date().toISOString().slice(0, 10),
        work_type: workTypes.length === 1 ? workTypes[0] : "",
        work_types: workTypes,
        certificate_no: "",
        discount_type: doc.discount_type || "none",
        discount_value: doc.discount_value || "",
        ...TAXES.reduce((flags, tax) => {
          flags[tax.key] = rows.some((row) => !!row[tax.key]);
          return flags;
        }, {}),
        vat_terms_only: rows.some((row) => !!row.vat_terms_only),
      });
      setEditingId(null);
      setEditorContext({
        workflowId,
        party: partyObject,
        document: null,
        reportData: null,
        copyRows: rows,
        copyToken: `${doc.id}-${Date.now()}`,
      });
      setEntryDirty(true);
      setActiveTab("entry");
      setMessage("تم نسخ البنود إلى مستند جديد مستقل. راجع البيانات ثم احفظه للحصول على ID جديد.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(`تعذر نسخ المستند: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function openChatMention(rawMention) {
    const mention = String(rawMention || "").replace(/^@/, "").trim();
    if (!mention) return;
    setMessage(`Opening @${mention}...`);
    try {
      const documentMatches = await api.request(
        `/api/documents?q=${encodeURIComponent(mention)}`,
      );
      const compactMention = mention.replace(/^0+(?=\d)/, "");
      const exactDocument = (documentMatches || []).find((doc) => {
        const candidates = [
          doc.operation_no,
          doc.document_no,
          doc.id,
          String(doc.document_no || "").replace(/^0+(?=\d)/, ""),
          String(doc.id || "").replace(/^0+(?=\d)/, ""),
        ]
          .filter(Boolean)
          .map(String);
        return candidates.some(
          (candidate) =>
            candidate === mention ||
            candidate === compactMention ||
            candidate.toLowerCase() === mention.toLowerCase(),
        );
      });
      const document = exactDocument || documentMatches?.[0];
      if (document) {
        await openDocumentPreview(document, {
          id: document.party_id,
          display_name: document.customer_name || document.display_name || "",
          base_name:
            document.base_name ||
            document.customer_name ||
            document.display_name ||
            "",
        });
        return;
      }

      const [customers, contractors, users] = await Promise.all([
        api.request(
          `/api/parties?role=customer&q=${encodeURIComponent(mention)}`,
        ),
        api.request(
          `/api/parties?role=contractor&q=${encodeURIComponent(mention)}`,
        ),
        api.request("/api/users"),
      ]);
      const customer = customers?.[0];
      if (customer) {
        setCustomerExplorerFocus({
          id: customer.id,
          name: customer.display_name || customer.base_name || mention,
          stamp: Date.now(),
        });
        switchToTab("dashboard");
        setMessage(`Opened customer @${customer.display_name || mention}.`);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const contractor = contractors?.[0];
      if (contractor) {
        updateReportContext("contractor", {
          party: contractor,
          partySearch: contractor.display_name || contractor.base_name || "",
          partyId: contractor.id ? String(contractor.id) : "",
          documentId: "",
          documentSearch: "",
          documents: [],
          reportData: null,
        });
        switchToTab("contractor");
        setMessage(
          `Opened contractor @${contractor.display_name || mention}.`,
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const person = (users || []).find((user) => {
        const haystack = `${user.display_name || ""} ${user.username || ""}`.toLowerCase();
        return haystack.includes(mention.toLowerCase());
      });
      if (person) {
        setMessage(
          `Mentioned ${person.display_name || person.username}${person.is_online ? " (online)" : ""}.`,
        );
        return;
      }
      setMessage(`No matching document, customer, contractor, or user for @${mention}.`);
    } catch (error) {
      setMessage(`Mention lookup failed: ${error.message}`);
    }
  }

  function handleDocumentSaved(savedDocument = {}) {
    const workflowId = workflowForDocument(savedDocument);
    const partyObject = savedDocument.party_id
      ? {
          id: savedDocument.party_id,
          display_name:
            savedDocument.display_name ||
            savedDocument.customer_name ||
            savedDocument.base_party_name ||
            "",
          base_name:
            savedDocument.base_party_name ||
            savedDocument.customer_name ||
            savedDocument.display_name ||
            "",
          category: savedDocument.category || "",
        }
      : null;
    const documentObject = {
      ...savedDocument,
      id: savedDocument.id || savedDocument.document_id,
      operation_no:
        savedDocument.operation_no || savedDocument.document_id || "",
      document_no:
        savedDocument.document_no || savedDocument.operation_no || "",
    };
    setEntryDirty(false);
    setEditingId(null);
    setEditorContext(null);
    updateReportContext(workflowId, {
      workflowId,
      party: partyObject,
      document: documentObject,
      partySearch:
        partyObject?.display_name || savedDocument.customer_name || "",
      partyId: partyObject?.id ? String(partyObject.id) : "",
      documentSearch: [documentObject.operation_no, documentObject.project]
        .filter(Boolean)
        .join(" - "),
      documentId: documentObject.id ? String(documentObject.id) : "",
      documents: documentObject.id ? [documentObject] : [],
      projectFilter: savedDocument.project || "",
      reportData: null,
      previewUrl: "",
      previewKey: "",
    });
    if (!APP_VARIANT.allowedTabs || APP_VARIANT.allowedTabs.includes(workflowId))
      setActiveTab(workflowId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!currentUser) return undefined;
    function openFromHash() {
      if (!window.location.hash.startsWith("#open-document?")) return;
      const params = new URLSearchParams(
        window.location.hash.replace("#open-document?", ""),
      );
      const id = params.get("id");
      if (!id) return;
      const type = params.get("type") || "price_offer";
      const doc = {
        id: type === "statement" ? id : Number(id),
        document_type: type,
        status: params.get("status") || "",
        operation_no: params.get("operation_no") || "",
        document_no: params.get("document_no") || "",
        project: params.get("project") || "",
        building_unit: params.get("building_unit") || "",
      };
      const party = params.get("party_id")
        ? {
            id: Number(params.get("party_id")),
            display_name: params.get("party_name") || "",
            base_name:
              params.get("party_base") || params.get("party_name") || "",
            category: params.get("party_category") || "",
          }
        : null;
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      openCustomerDocument(doc, party);
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [currentUser]);

  async function saveEntry(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const method = editingId ? "PUT" : "POST";
      const path = editingId ? `/api/entries/${editingId}` : "/api/entries";
      await api.request(path, {
        method,
        body: JSON.stringify({
          ...entryForm,
          created_by: currentUser?.display_name,
          updated_by: currentUser?.display_name,
        }),
      });
      setEntryForm(variantEntryDefaults());
      setEditingId(null);
      setEntryDirty(false);
      setMessage(editingId ? "تم تعديل البند." : "تم حفظ البند.");
      await refreshLocalData();
      await refreshContextReport();
    } catch (error) {
      setMessage(`لم يتم الحفظ: ${error.message}`);
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  async function deleteEntry(id) {
    if (!window.confirm("حذف هذا البند؟")) return;
    setBusy(true);
    try {
      await api.request(`/api/entries/${id}`, { method: "DELETE" });
      setMessage("تم حذف البند.");
      await refreshLocalData();
      await refreshContextReport();
    } catch (error) {
      setMessage(`لم يتم الحذف: ${error.message}`);
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  function editRow(row, context = null) {
    const documentId = row.document_id || context?.document?.id;
    if (documentId) {
      openCustomerDocument(
        {
          ...(context?.document || {}),
          id: documentId,
          document_type:
            context?.document?.document_type ||
            row.document_type ||
            mapRowToForm(row).document_type,
          status:
            context?.document?.status || row.document_status || "draft",
          operation_no:
            context?.document?.operation_no || row.operation_no || "",
          document_no: context?.document?.document_no || row.serial || "",
          project: context?.document?.project || row.project || "",
          building_unit:
            context?.document?.building_unit || row.building_unit || "",
          party_id: context?.party?.id || row.party_id || "",
          customer_name:
            context?.party?.display_name ||
            row.customer_display_name ||
            row.customer_name ||
            "",
        },
        context?.party || {
          id: row.party_id,
          display_name: row.customer_display_name || row.customer_name || "",
          base_name: row.base_party_name || row.customer_name || "",
          category: row.party_category || "",
        },
      );
      return;
    }
    if (
      entryDirty &&
      !window.confirm(
        "تحذير: فتح هذا البند سيستبدل الإدخال غير المحفوظ الحالي. هل تريد المتابعة؟",
      )
    )
      return;
    setEntryForm(mapRowToForm(row));
    setEditingId(row.id);
    setEditorContext(context);
    setEntryDirty(false);
    setActiveTab(
      mapRowToForm(row).document_type === "contractor_certificate"
        ? "contractor"
        : "entry",
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function newRowFromContext(workflow, party, document) {
    if (entryDirty) {
      const ok = window.confirm(
        "تحذير: إنشاء مستند جديد سيستبدل الإدخال غير المحفوظ الحالي. هل تريد المتابعة؟",
      );
      if (!ok) return;
    }
    const type =
      document?.document_type || workflow.documentType || "price_offer";
    const meta = documentTypeMeta(type);
    setEntryForm({
      ...DEFAULT_ENTRY,
      party_role: workflow.partyRole,
      party_category: party?.category || "unselected",
      base_party_name: party?.base_name || "",
      customer_name: party?.base_name || "",
      customer_display_name: party?.display_name || "",
      search_party_name: party?.search_name || "",
      party_id: party?.id || "",
      document_id: document?.id || "",
      document_type: type,
      document_status: document?.status || meta.status,
      serial: document?.document_no || "",
      operation_no: document?.operation_no || "",
      project: document?.project || "",
      building_unit: document?.building_unit || "",
    });
    setEditingId(null);
    setEntryDirty(false);
    setEditorContext({
      workflowId:
        Object.entries(WORKFLOWS).find(([, item]) => item === workflow)?.[0] ||
        "offer",
      party,
      document,
      reportData:
        reportContexts[
          Object.entries(WORKFLOWS).find(
            ([, item]) => item === workflow,
          )?.[0] || "offer"
        ]?.reportData || null,
    });
    setActiveTab(type === "contractor_certificate" ? "contractor" : "entry");
  }

  async function createBackup() {
    setBusy(true);
    try {
      const data = await api.request("/api/backup", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(`تم إنشاء نسخة احتياطية: ${data.backupPath}`);
    } catch (error) {
      setMessage(`تعذر إنشاء النسخة الاحتياطية: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!termsAccepted) {
    return (
      <>
        {showSplash && <SplashScreen />}
        <NoticeCenter notices={notices} onClose={closeNotice} />
        <TermsGate
          onAccept={() => {
            localStorage.setItem(SERVICE_TERMS_STORAGE_KEY, SERVICE_TERMS_VERSION);
            setTermsAccepted(true);
          }}
        />
      </>
    );
  }

  if (!currentUser) {
    return (
      <>
        {showSplash && <SplashScreen />}
        <CompanyLoginView
          apiBase={apiBase}
          setApiBase={setApiBase}
          login={login}
          createAccount={createAccount}
          message={notices.at(-1)?.text || ""}
          busy={busy}
        />
      </>
    );
  }

  if (subscriptionState?.can_use_app === false) {
    return (
      <>
        {showSplash && <SplashScreen />}
        <main className="shell subscription-lock-shell" dir="rtl">
          <section className="workspace subscription-lock-workspace">
            <header className="topbar">
              <div className="title-stack">
                <h1>الإشتراك والدفع</h1>
                <span>Local server</span>
              </div>
              <img className="top-logo" src={companyHeaderLogo} alt={APP_NAME} />
              <div className="top-actions">
                <SessionStatusChip
                  user={currentUser}
                  online={networkOnline && currentUser?.is_online !== false}
                  now={sessionNow}
                />
                <button
                  type="button"
                  className={
                    developerDataVisible
                      ? "icon-button compact-top-control developer-data-toggle active"
                      : "icon-button compact-top-control developer-data-toggle"
                  }
                  title={
                    developerDataVisible
                      ? "Hide developer data"
                      : "Show developer data"
                  }
                  aria-pressed={developerDataVisible}
                  onClick={() => setDeveloperDataVisible((visible) => !visible)}
                >
                  <Activity size={18} />
                </button>
                <button
                  className="icon-button compact-top-control"
                  title={`Theme: ${themeMode}`}
                  onClick={cycleThemeMode}
                >
                  {themeMode === "light" ? (
                    <Sun size={18} />
                  ) : themeMode === "dark" ? (
                    <Moon size={18} />
                  ) : (
                    <Monitor size={18} />
                  )}
                </button>
                <button className="icon-button" title="خروج" onClick={logout}>
                  <LogOut size={18} />
                </button>
              </div>
            </header>
            {renderDeveloperDataStrip()}
            <NoticeCenter notices={notices} onClose={closeNotice} />
            <SubscriptionBlockedNotice
              state={subscriptionState}
              onPay={focusSubscriptionPanel}
            />
            <SettingsView
              api={api}
              currentUser={currentUser}
              apiBase={apiBase}
              setApiBase={setApiBase}
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              health={health}
              bootstrap={bootstrap}
              terms={terms}
              setTerms={setTerms}
              reportBranding={reportBranding}
              setReportBranding={setReportBranding}
              subscriptionPlans={subscriptionPlans}
              setSubscriptionPlans={setSubscriptionPlans}
              setSubscriptionState={setSubscriptionState}
              createBackup={createBackup}
              setMessage={setMessage}
              busy={busy}
              updateInfo={updateInfo}
              checkingUpdate={checkingUpdate}
              checkForUpdates={checkForUpdates}
              openUpdateDownload={openUpdateDownload}
              subscriptionOnly
            />
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen />}
      <main className="shell" dir="rtl">
        <aside className="sidebar">
          <div className="brand">
            <AppBrandMark small />
            <div>
              <strong>{APP_VARIANT.name}</strong>
              <span>{APP_BYLINE}</span>
            </div>
          </div>
          <nav className="main-nav">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={activeTab === id ? "active" : ""}
                onClick={() => requestTabChange(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <div className="title-stack">
              <h1>{(NAV_ITEMS.find((tab) => tab.id === activeTab) || NAV.find((tab) => tab.id === activeTab))?.label}</h1>
              <span>{health?.ok ? "Local server" : APP_MARK}</span>
            </div>
            <img className="top-logo" src={companyHeaderLogo} alt={APP_NAME} />
            <div className="top-actions">
              <SessionStatusChip
                user={currentUser}
                online={networkOnline && currentUser?.is_online !== false}
                now={sessionNow}
              />
              <button
                type="button"
                className={
                  updateInfo?.updateAvailable || updateInfo?.canInstall
                    ? "update-chip available"
                    : "update-chip"
                }
                title={
                  updateInfo?.canInstall
                    ? `Restart to install ${updateInfo.latestVersion}`
                    : updateInfo?.status === "downloading"
                      ? `Downloading update ${Math.round(updateInfo.downloadPercent || 0)}%`
                      : updateInfo?.updateAvailable
                    ? `Update available: ${updateInfo.latestVersion}`
                    : checkingUpdate
                      ? "Checking for updates..."
                      : updateInfo?.status === "current"
                        ? `Application is current (${updateInfo.currentVersion})`
                        : updateInfo?.status === "error"
                          ? "Update check failed"
                          : `Installed version: v${APP_DISPLAY_VERSION}`
                }
                onClick={
                  updateInfo?.updateAvailable || updateInfo?.canInstall
                    ? openUpdateDownload
                    : () => checkForUpdates(false)
                }
                disabled={checkingUpdate}
              >
                {updateInfo?.updateAvailable || updateInfo?.canInstall ? (
                  <RefreshCw
                    size={14}
                    className={checkingUpdate ? "animate-spin" : ""}
                  />
                ) : (
                  <Check size={14} />
                )}
                <span>
                  {updateInfo?.canInstall
                    ? `Restart to install ${updateInfo.latestVersion}`
                    : updateInfo?.status === "downloading"
                      ? `Downloading ${Math.round(updateInfo.downloadPercent || 0)}%`
                      : updateInfo?.updateAvailable
                        ? `Update ${updateInfo.latestVersion} Available`
                        : checkingUpdate
                          ? "Checking..."
                          : updateInfo?.status === "current"
                            ? updateInfo.currentVersion
                            : updateInfo?.status === "error"
                              ? "Update check failed"
                              : `Installed v${APP_DISPLAY_VERSION}`}
                </span>
              </button>
              <button
                type="button"
                className={
                  developerDataVisible
                    ? "icon-button compact-top-control developer-data-toggle active"
                    : "icon-button compact-top-control developer-data-toggle"
                }
                title={
                  developerDataVisible
                    ? "Hide developer data"
                    : "Show developer data"
                }
                aria-pressed={developerDataVisible}
                onClick={() => setDeveloperDataVisible((visible) => !visible)}
              >
                <Activity size={18} />
              </button>
              <button
                className="icon-button compact-top-control"
                title={`Theme: ${themeMode}`}
                onClick={cycleThemeMode}
              >
                {themeMode === "light" ? (
                  <Sun size={18} />
                ) : themeMode === "dark" ? (
                  <Moon size={18} />
                ) : (
                  <Monitor size={18} />
                )}
              </button>
              <button
                className="icon-button"
                title="تحديث"
                onClick={refreshAll}
                disabled={busy}
              >
                <RefreshCw size={18} />
              </button>
              <button className="icon-button" title="خروج" onClick={logout}>
                <LogOut size={18} />
              </button>
              <span className={health?.ok ? "status ok" : "status bad"}>
                {health?.ok ? "متصل" : "غير متصل"}
              </span>
            </div>
          </header>

          {renderDeveloperDataStrip()}

          {!showSplash && busy && <LoadingOverlay />}

          <NoticeCenter notices={notices} onClose={closeNotice} />

          {subscriptionModalVisible && (
            <SubscriptionGateModal
              state={subscriptionState}
              onClose={() => setSubscriptionModalVisible(false)}
              onSubscribe={() => {
                setActiveTab("settings");
                setSubscriptionModalVisible(false);
              }}
            />
          )}

          {activeTab === "dashboard" && (
            <Dashboard
              api={api}
              apiBase={apiBase}
              currentUser={currentUser}
              bootstrap={bootstrap}
              focus={customerExplorerFocus}
              refreshKey={refreshKey}
              setMessage={setMessage}
              onOpenDocument={openCustomerDocument}
              onCopyDocument={copyDocumentAsNew}
              onDocumentConverted={handleDocumentSaved}
              onEditRow={editRow}
              onDeleteRow={deleteEntry}
              onNewRow={newRowFromContext}
              context={reportContexts.dashboard}
              setContext={(patch) => updateReportContext("dashboard", patch)}
            />
          )}
          {activeTab === "offer" && (
            <ReportWorkspace
              workflowId="offer"
              locked
              api={api}
              apiBase={apiBase}
              currentUser={currentUser}
              refreshKey={refreshKey}
              setMessage={setMessage}
              onOpenDocument={openCustomerDocument}
              onCopyDocument={copyDocumentAsNew}
              onDocumentConverted={handleDocumentSaved}
              onEditRow={editRow}
              onDeleteRow={deleteEntry}
              onNewRow={newRowFromContext}
              context={reportContexts.offer}
              setContext={(patch) => updateReportContext("offer", patch)}
            />
          )}
          {activeTab === "invoice" && (
            <ReportWorkspace
              workflowId="invoice"
              locked
              api={api}
              apiBase={apiBase}
              currentUser={currentUser}
              refreshKey={refreshKey}
              setMessage={setMessage}
              onOpenDocument={openCustomerDocument}
              onCopyDocument={copyDocumentAsNew}
              onDocumentConverted={handleDocumentSaved}
              onEditRow={editRow}
              onDeleteRow={deleteEntry}
              onNewRow={newRowFromContext}
              context={reportContexts.invoice}
              setContext={(patch) => updateReportContext("invoice", patch)}
            />
          )}
          {activeTab === "statement" && (
            <ReportWorkspace
              workflowId="statement"
              locked
              api={api}
              apiBase={apiBase}
              currentUser={currentUser}
              refreshKey={refreshKey}
              setMessage={setMessage}
              onOpenDocument={openCustomerDocument}
              onCopyDocument={copyDocumentAsNew}
              onDocumentConverted={handleDocumentSaved}
              onEditRow={editRow}
              onDeleteRow={deleteEntry}
              onNewRow={newRowFromContext}
              context={reportContexts.statement}
              setContext={(patch) => updateReportContext("statement", patch)}
            />
          )}
          {activeTab === "contractor" && (
            <div className="page-stack">
              <ContractorsView
                api={api}
                currentUser={currentUser}
                setMessage={setMessage}
                refreshKey={refreshKey}
              />
              <section className="panel contractor-entry-launcher">
                <div>
                  <h2>أعمال ودفعات المقاولين</h2>
                  <p>إدخال المستخلصات والأعمال والدفعات الخاصة بالمقاولين من هذا القسم فقط.</p>
                </div>
                <button
                  type="button"
                  className="primary"
                  onClick={() => newRowFromContext(WORKFLOWS.contractor, null, null)}
                >
                  <Plus size={17} /> إدخال مستخلص / أعمال مقاول
                </button>
              </section>
              {editorContext?.workflowId === "contractor" && (
                <EntryEditor
                  api={api}
                  lookups={lookups}
                  entryForm={entryForm}
                  setEntryForm={updateEntryForm}
                  setEntryDirty={setEntryDirty}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  saveEntry={saveEntry}
                  editorContext={editorContext}
                  onEditRow={editRow}
                  onDeleteRow={deleteEntry}
                  setMessage={setMessage}
                  onCloseContext={() => {
                    setEditorContext(null);
                    setEditingId(null);
                    setEntryDirty(false);
                    setEntryForm(variantEntryDefaults());
                    setActiveTab("contractor");
                  }}
                  onBack={() => setActiveTab("contractor")}
                  busy={busy}
                  currentUser={currentUser}
                  refreshAll={refreshLocalData}
                  onDocumentSaved={handleDocumentSaved}
                  scopeRole="contractor"
                />
              )}
              <ReportWorkspace
                workflowId="contractor"
                locked
                api={api}
                apiBase={apiBase}
                currentUser={currentUser}
                refreshKey={refreshKey}
                setMessage={setMessage}
                onOpenDocument={openCustomerDocument}
                onCopyDocument={copyDocumentAsNew}
                onDocumentConverted={handleDocumentSaved}
                onEditRow={editRow}
                onDeleteRow={deleteEntry}
                onNewRow={newRowFromContext}
                context={reportContexts.contractor}
                setContext={(patch) => updateReportContext("contractor", patch)}
              />
              <PaymentsView
                api={api}
                lookups={lookups}
                currentUser={currentUser}
                refreshKey={refreshKey}
                setMessage={setMessage}
                refreshAll={refreshLocalData}
                partyRole="contractor"
              />
            </div>
          )}
          {activeTab === "quantities" && (
            <ProductiveQuantitiesView
              api={api}
              apiBase={apiBase}
              lookups={lookups}
              setMessage={setMessage}
            />
          )}
          {activeTab === "payments" && (
            <PaymentsView
              api={api}
              lookups={lookups}
              currentUser={currentUser}
              refreshKey={refreshKey}
              setMessage={setMessage}
              refreshAll={refreshLocalData}
              focus={paymentFocus}
              partyRole="customer"
            />
          )}
          {editorContext?.workflowId !== "contractor" && (
          <div className="entry-state-host" hidden={activeTab !== "entry"}>
            <EntryEditor
              api={api}
              lookups={lookups}
              entryForm={entryForm}
              setEntryForm={updateEntryForm}
              setEntryDirty={setEntryDirty}
              editingId={editingId}
              setEditingId={setEditingId}
              saveEntry={saveEntry}
              editorContext={editorContext}
              onEditRow={editRow}
              onDeleteRow={deleteEntry}
              setMessage={setMessage}
              onCloseContext={(options = {}) => {
                if (
                  !options?.force &&
                  entryDirty &&
                  !window.confirm(
                    "هناك تعديل أو إضافة لم يتم حفظها. هل تريد إغلاق التقرير المرتبط؟",
                  )
                )
                  return;
                const targetTab =
                  editorContext?.workflowId && WORKFLOWS[editorContext.workflowId]
                    ? editorContext.workflowId
                    : "dashboard";
                setEditorContext(null);
                setEditingId(null);
                setEntryDirty(false);
                setEntryForm(variantEntryDefaults());
                setMessage("");
                setActiveTab(targetTab);
              }}
              onBack={() => {
                if (
                  entryDirty &&
                  !window.confirm(
                    "هناك تعديل أو إضافة لم يتم حفظها. هل تريد الرجوع؟",
                  )
                )
                  return;
                setEditorContext(null);
                setEditingId(null);
                setEntryDirty(false);
                setEntryForm(variantEntryDefaults());
                setMessage("");
                setActiveTab("dashboard");
              }}
              busy={busy}
              currentUser={currentUser}
              refreshAll={refreshLocalData}
              onDocumentSaved={handleDocumentSaved}
              scopeRole="customer"
            />
          </div>
          )}
          {activeTab === "settings" && (
            <SettingsView
              api={api}
              currentUser={currentUser}
              apiBase={apiBase}
              setApiBase={setApiBase}
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              health={health}
              bootstrap={bootstrap}
              terms={terms}
              setTerms={setTerms}
              reportBranding={reportBranding}
              setReportBranding={setReportBranding}
              subscriptionPlans={subscriptionPlans}
              setSubscriptionPlans={setSubscriptionPlans}
              setSubscriptionState={setSubscriptionState}
              createBackup={createBackup}
              setMessage={setMessage}
              busy={busy}
              updateInfo={updateInfo}
              checkingUpdate={checkingUpdate}
              checkForUpdates={checkForUpdates}
              openUpdateDownload={openUpdateDownload}
              managerEvents={managerEvents}
              onManagerEventAction={updateManagerEventState}
            />
          )}
        </section>
        <ChatWidget
          api={api}
          apiBase={apiBase}
          currentUser={currentUser}
          setMessage={setMessage}
          onOpenMention={openChatMention}
        />
      </main>
    </>
  );
}

function AppBrandMark({ small = false }) {
  return (
    <div
      className={small ? "am-brand-mark small" : "am-brand-mark"}
      dir="ltr"
      aria-label={`${APP_MARK} ${APP_BYLINE}`}
    >
      <span className="brand-digit-cloud" aria-hidden="true">
        {"0123456789".split("").map((digit, index) => (
          <span key={`${digit}-${index}`} style={{ "--digit-index": index }}>
            {digit}
          </span>
        ))}
      </span>
      <strong>
        <span className="am-a">A</span>
        <span className="am-dot">.</span>
        <span className="am-m">M</span>
      </strong>
      <small>{APP_BYLINE}</small>
    </div>
  );
}

function readyCountClass(count) {
  if (!count) return "zero";
  if (count < 10) return "blue";
  if (count < 20) return "green";
  return `wheel-${Math.floor(count / 10) % 6}`;
}

function ItemReadyBadge({ count, suffix = "بند جاهز" }) {
  return (
    <span
      className={`ready-count ${readyCountClass(count)}`}
      title={`${count} ${suffix}`}
    >
      <strong>{count}</strong>
      <span>{suffix}</span>
    </span>
  );
}

function DocumentIdSearch({
  api,
  type = "",
  status = "",
  value,
  onChange,
  onSelect,
  title = "Search by document ID",
  placeholder = "ID / رقم مستند",
}) {
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(false);
  const query = String(value || "").trim();
  const visibleItems = items.slice(0, 8);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!query) {
        setItems([]);
        return;
      }
      const params = new URLSearchParams({ q: query });
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      try {
        const data = await api.request(`/api/documents?${params.toString()}`);
        if (!cancelled) setItems(data || []);
      } catch {
        if (!cancelled) setItems([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, query, type, status]);

  function choose(doc) {
    onChange(documentOptionText(doc));
    onSelect?.(doc);
    setActive(false);
  }

  return (
    <Field label="ID / رقم مستند">
      <div className="inline-field document-id-search" title={title}>
        <Search size={16} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setActive(true)}
          onBlur={() => window.setTimeout(() => setActive(false), 300)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visibleItems.length) {
              event.preventDefault();
              const exact = visibleItems.find((doc) =>
                documentMatchesSearch(doc, query),
              );
              choose(exact || visibleItems[0]);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          inputMode="search"
          dir="auto"
        />
        {active && visibleItems.length > 0 && (
          <div className="inline-suggestions document-id-suggestions">
            {visibleItems.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onMouseDown={() => choose(doc)}
              >
                <strong>{doc.operation_no || doc.document_no || doc.id}</strong>
                <span>
                  {[doc.customer_name || doc.display_name, doc.project]
                    .filter(Boolean)
                    .join(" - ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

function SplashScreen() {
  return (
    <div className="splash-screen" dir="ltr" aria-label={`${APP_NAME} loading`}>
      <AppBrandMark />
      <span className="splash-title">{APP_NAME}</span>
    </div>
  );
}

function LoadingOverlay({ compact = false }) {
  return (
    <div
      className={
        compact ? "loading-overlay compact-loading" : "loading-overlay"
      }
      dir="ltr"
      aria-label="Loading"
    >
      <AppBrandMark small />
      <span className="splash-title">Loading</span>
    </div>
  );
}

function CompanyLoginView({ apiBase, setApiBase, login, createAccount, message, busy }) {
  const [mode, setMode] = useState("login");
  const [companyName, setCompanyName] = useState(
    () => localStorage.getItem("priceOfferLastCompany") || "",
  );
  const [name, setName] = useState(
    () => localStorage.getItem("priceOfferLastUsername") || "",
  );
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState(() =>
    safeApiBaseForCurrentPage(apiBase, DEFAULT_API_BASE),
  );
  const [serverBusy, setServerBusy] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    address: "Cairo, Egypt",
    website: "",
    user_name: "",
    password: "",
    data_folder: "",
    local_port: String(DEFAULT_LOCAL_PORT),
    manager_api_base: MANAGER_PUBLIC_URL,
    database_provider: "local",
    remote_database_url: "",
  });
  const [error, setError] = useState("");
  const serverCandidates = useMemo(
    () =>
      [
        serverUrl,
        ...(window.priceOfferDesktop?.serverCandidates || []),
        DEFAULT_API_BASE,
        `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`,
        `http://localhost:${DEFAULT_LOCAL_PORT}`,
      ]
        .map(cleanApiBase)
        .filter(Boolean)
        .filter(isApiBaseUsableOnCurrentPage)
        .filter((value, index, all) => all.indexOf(value) === index),
    [serverUrl],
  );

  useEffect(() => {
    setServerUrl(safeApiBaseForCurrentPage(apiBase, DEFAULT_API_BASE));
  }, [apiBase]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const cleanServer = safeApiBaseForCurrentPage(serverUrl, apiBase || DEFAULT_API_BASE);
      setApiBase?.(cleanServer);
      await login(
        {
          username: name,
          password,
          company_name: companyName,
          apiBase: cleanServer,
        },
        cleanServer,
      );
    } catch (loginError) {
      setError(`Could not log in: ${loginError.message}`);
    }
  }

  async function submitCreate(event) {
    event.preventDefault();
    setError("");
    try {
      const result = await createAccount(createDraft);
      setCompanyName(createDraft.company_name);
      setName(createDraft.user_name);
      setPassword(createDraft.password);
      const currentMode = connectionModeForApiBase(apiBase);
      const nextServer = safeApiBaseForCurrentPage(
        currentMode === "remote"
          ? apiBase
          : result?.server?.serverUrl || result?.server?.localUrl,
        apiBase || DEFAULT_API_BASE,
      );
      setServerUrl(nextServer);
      setApiBase?.(nextServer, { connectionMode: currentMode });
      await login(
        {
          username: createDraft.user_name,
          password: createDraft.password,
          company_name: createDraft.company_name,
          apiBase: nextServer,
        },
        nextServer,
      );
    } catch (createError) {
      setError(`Could not create account: ${createError.message}`);
    }
  }

  function updateCreateDraft(key, value) {
    setCreateDraft((current) => ({ ...current, [key]: value }));
  }

  async function chooseCreateDataFolder() {
    const picked = await window.priceOfferDesktop?.chooseDirectory?.();
    if (picked) updateCreateDraft("data_folder", picked);
  }

  async function startLocalServer() {
    if (!window.priceOfferDesktop?.startLocalServer) return;
    setServerBusy(true);
    setError("");
    try {
      const info = await window.priceOfferDesktop.startLocalServer();
      const next = safeApiBaseForCurrentPage(
        info?.serverUrl || info?.apiBase || info?.localUrl,
        apiBase || DEFAULT_API_BASE,
      );
      setServerUrl(next);
      setApiBase?.(next, { connectionMode: "local" });
      setError(info?.message || "Local server is running.");
    } catch (serverError) {
      setError(`Could not start local server: ${serverError.message}`);
    } finally {
      setServerBusy(false);
      restoreInputInteractivity();
    }
  }

  return (
    <main className="login-shell" dir="rtl">
      <section className="login-panel company-login-panel">
        <div className="login-brand">
          <AppBrandMark small />
          <div>
            <strong>{APP_NAME}</strong>
            <span>{APP_BYLINE}</span>
          </div>
        </div>
        <div className="login-mode-switch" dir="ltr">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === "create" ? "active" : ""}
            onClick={() => setMode("create")}
          >
            Create account
          </button>
        </div>
        {mode === "login" ? (
          <form onSubmit={submit} className="login-form">
            <Field label="Company name">
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                autoComplete="organization"
              />
            </Field>
            <Field label="User name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="Local server / tunnel">
              <div className="server-login-row">
                <input
                  dir="ltr"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  list="company-server-login-candidates"
                  autoComplete="url"
                />
                {window.priceOfferDesktop?.startLocalServer && (
                  <button
                    type="button"
                    className="icon-button"
                    title="Start local server"
                    onClick={startLocalServer}
                    disabled={serverBusy || busy}
                  >
                    <Server size={17} />
                  </button>
                )}
                <datalist id="company-server-login-candidates">
                  {serverCandidates.map((candidate) => (
                    <option key={candidate} value={candidate} />
                  ))}
                </datalist>
              </div>
            </Field>
            <button className="primary" disabled={busy}>
              <KeyRound size={18} /> Log in
            </button>
          </form>
        ) : (
          <form onSubmit={submitCreate} className="login-form create-company-form">
            <Field label="Company name">
              <input
                value={createDraft.company_name}
                onChange={(event) => updateCreateDraft("company_name", event.target.value)}
                autoComplete="organization"
                required
              />
            </Field>
            <Field label="Manager / contact name">
              <input
                value={createDraft.contact_name}
                onChange={(event) => updateCreateDraft("contact_name", event.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field label="Email">
              <input
                dir="ltr"
                type="email"
                value={createDraft.email}
                onChange={(event) => updateCreateDraft("email", event.target.value)}
                autoComplete="email"
              />
            </Field>
            <Field label="Phone">
              <input
                dir="ltr"
                value={createDraft.phone}
                onChange={(event) => updateCreateDraft("phone", event.target.value)}
                autoComplete="tel"
              />
            </Field>
            <Field label="Company address">
              <textarea
                value={createDraft.address}
                onChange={(event) => updateCreateDraft("address", event.target.value)}
                required
              />
            </Field>
            <Field label="Website">
              <input
                dir="ltr"
                value={createDraft.website}
                onChange={(event) => updateCreateDraft("website", event.target.value)}
                autoComplete="url"
              />
            </Field>
            <Field label="Login name">
              <input
                value={createDraft.user_name}
                onChange={(event) => updateCreateDraft("user_name", event.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={createDraft.password}
                onChange={(event) => updateCreateDraft("password", event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            {connectionModeForApiBase(apiBase) !== "remote" && (
              <>
            <Field label="Company database folder">
              <div className="server-path-row">
                <input
                  dir="ltr"
                  value={createDraft.data_folder}
                  onChange={(event) => updateCreateDraft("data_folder", event.target.value)}
                  required={connectionModeForApiBase(apiBase) !== "remote"}
                />
                <button
                  type="button"
                  onClick={chooseCreateDataFolder}
                  disabled={!window.priceOfferDesktop?.chooseDirectory}
                >
                  <HardDrive size={17} /> Browse
                </button>
              </div>
            </Field>
            <Field label="New local server port">
              <input
                dir="ltr"
                type="text"
                inputMode="numeric"
                value={createDraft.local_port}
                onChange={(event) => updateCreateDraft("local_port", event.target.value)}
                required
              />
            </Field>
              </>
            )}
            <Field label="Manager API URL">
              <input
                dir="ltr"
                value={createDraft.manager_api_base}
                onChange={(event) =>
                  updateCreateDraft("manager_api_base", event.target.value)
                }
                autoComplete="url"
                required
              />
            </Field>
            {connectionModeForApiBase(apiBase) !== "remote" && (
              <>
            <Field label="Database provider">
              <select
                value={createDraft.database_provider}
                onChange={(event) =>
                  updateCreateDraft("database_provider", event.target.value)
                }
              >
                <option value="local">Local SQLite</option>
                <option value="remote">Remote URL / tunnel</option>
              </select>
            </Field>
            <Field label="Remote database URL">
              <input
                dir="ltr"
                value={createDraft.remote_database_url}
                onChange={(event) =>
                  updateCreateDraft("remote_database_url", event.target.value)
                }
                autoComplete="url"
              />
            </Field>
              </>
            )}
            <button className="primary" disabled={busy}>
              <UserPlus size={18} /> Create account
            </button>
          </form>
        )}
        {(error || message) && <div className="notice">{error || message}</div>}
      </section>
    </main>
  );
}

function LoginView({ apiBase, setApiBase, login, message, busy }) {
  const [name, setName] = useState(
    () => localStorage.getItem("priceOfferLastUsername") || "",
  );
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState(() =>
    safeApiBaseForCurrentPage(apiBase, DEFAULT_API_BASE),
  );
  const [serverBusy, setServerBusy] = useState(false);
  const [error, setError] = useState("");
  const serverCandidates = useMemo(
    () =>
      [
        serverUrl,
        ...(window.priceOfferDesktop?.serverCandidates || []),
        DEFAULT_API_BASE,
        `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`,
        `http://localhost:${DEFAULT_LOCAL_PORT}`,
      ]
        .map(cleanApiBase)
        .filter(Boolean)
        .filter(isApiBaseUsableOnCurrentPage)
        .filter((value, index, all) => all.indexOf(value) === index),
    [serverUrl],
  );

  useEffect(() => {
    setServerUrl(safeApiBaseForCurrentPage(apiBase, DEFAULT_API_BASE));
  }, [apiBase]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const cleanServer = safeApiBaseForCurrentPage(serverUrl, apiBase || DEFAULT_API_BASE);
      setApiBase?.(cleanServer);
      await login({ username: name, password, apiBase: cleanServer }, cleanServer);
    } catch (loginError) {
      setError(`تعذر تسجيل الدخول: ${loginError.message}`);
    }
  }

  async function startLocalServer() {
    if (!window.priceOfferDesktop?.startLocalServer) return;
    setServerBusy(true);
    setError("");
    try {
      const info = await window.priceOfferDesktop.startLocalServer();
      const next = safeApiBaseForCurrentPage(
        info?.serverUrl || info?.apiBase || info?.localUrl,
        apiBase || DEFAULT_API_BASE,
      );
      setServerUrl(next);
      setApiBase?.(next, { connectionMode: "local" });
      setError(info?.message || "Local server is running.");
    } catch (serverError) {
      setError(`تعذر تشغيل السيرفر المحلي: ${serverError.message}`);
    } finally {
      setServerBusy(false);
      restoreInputInteractivity();
    }
  }

  return (
    <main className="login-shell" dir="rtl">
      <section className="login-panel">
        <div className="login-brand">
          <AppBrandMark small />
          <div>
            <strong>{APP_NAME}</strong>
            <span>{APP_BYLINE}</span>
          </div>
        </div>
        <form onSubmit={submit} className="login-form">
          <Field label="اسم المستخدم">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="كلمة المرور">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="السيرفر المحلي / الرابط">
            <div className="server-login-row">
              <input
                dir="ltr"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                list="server-login-candidates"
                autoComplete="url"
              />
              {window.priceOfferDesktop?.startLocalServer && (
                <button
                  type="button"
                  className="icon-button"
                  title="Start local server"
                  onClick={startLocalServer}
                  disabled={serverBusy || busy}
                >
                  <Server size={17} />
                </button>
              )}
              <datalist id="server-login-candidates">
                {serverCandidates.map((candidate) => (
                  <option key={candidate} value={candidate} />
                ))}
              </datalist>
            </div>
          </Field>
          <button className="primary" disabled={busy}>
            <KeyRound size={18} /> دخول
          </button>
        </form>
        {(error || message) && <div className="notice">{error || message}</div>}
      </section>
    </main>
  );
}

function DashboardMetricGrid({ summary = {} }) {
  const metrics = [
    ["القيد", summary.rows],
    ["المستند", summary.documents],
    ["عميل/مقاول", summary.customers],
    ["إجمالي عروض الأسعار", summary.offers_total],
    ["إجمالي الفواتير (التحصيل)", summary.invoices_total],
    ["إجمالي المقاولين (الخصوم)", summary.contractor_total],
  ];

  return (
    <section className="metric-grid dashboard-metrics-panel">
      {metrics.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{money(value)}</strong>
        </div>
      ))}
    </section>
  );
}

function DocumentStatusPanel({ docs = [] }) {
  return (
    <section className="panel document-status-panel">
      <div className="panel-head">
        <h2>حالة المستندات</h2>
      </div>
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>النوع</th>
              <th>الحالة</th>
              <th>العدد</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((row) => (
              <tr key={`${row.document_type}-${row.status}`}>
                <td>{documentTypeLabel(row.document_type)}</td>
                <td>{statusLabel(row.status)}</td>
                <td>{money(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RemovedOwnerPanel({
  api,
  overview,
  setOverview,
  plans = [],
  setPlans,
  currentUser,
  setMessage,
}) {
  const [password, setPassword] = useState("");
  const [planDrafts, setPlanDrafts] = useState(plans || []);
  const [subscriberEdits, setSubscriberEdits] = useState({});
  const isAdmin = currentUser?.role === "admin";

  useEffect(() => setPlanDrafts(plans || []), [plans]);

  const loadOverview = useCallback(async () => {
    try {
      const data = { counts: {}, devices: [], users: [], subscribers: [], plans };
      setOverview?.(data);
      setPlans?.(data.plans || []);
    } catch (error) {
      setMessage?.(`Controller refresh failed: ${error.message}`);
    }
  }, [api, setMessage, setOverview, setPlans]);

  useEffect(() => {
    loadOverview();
    const timer = window.setInterval(loadOverview, 15000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  function updatePlan(index, key, value) {
    setPlanDrafts((current) =>
      current.map((plan, itemIndex) =>
        itemIndex === index ? { ...plan, [key]: value } : plan,
      ),
    );
  }

  async function savePlans(event) {
    event.preventDefault();
    try {
      const data = await api.request("/api/subscription/plans", {
        method: "PUT",
        body: JSON.stringify({ password, plans: planDrafts }),
      });
      setPlans?.(data.plans || []);
      setMessage?.("Subscription plans saved.");
      await loadOverview();
    } catch (error) {
      setMessage?.(`Could not save plans: ${error.message}`);
    }
  }

  async function saveSubscriber(id) {
    const patch = subscriberEdits[id];
    if (!patch) return;
    try {
      const updated = await api.request(`/api/subscriptions/${id}`, {
        method: "PUT",
        body: JSON.stringify({ password, ...patch }),
      });
      setOverview?.((current) => ({
        ...current,
        subscribers: (current?.subscribers || []).map((row) =>
          row.id === id ? updated : row,
        ),
      }));
      setSubscriberEdits((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage?.("Subscriber updated.");
    } catch (error) {
      setMessage?.(`Could not update subscriber: ${error.message}`);
    }
  }

  const counts = overview?.counts || {};
  const devices = overview?.devices || [];
  const users = overview?.users || [];
  const subscribers = overview?.subscribers || [];

  return (
    <div className="page-stack controller-page">
      <section className="panel">
        <div className="panel-head">
          <h2>
            <Activity size={18} /> Controller
          </h2>
          <button type="button" onClick={loadOverview}>
            <RefreshCw size={17} /> Refresh
          </button>
        </div>
        <div className="metric-grid">
          <MetricCard label="Online users" value={counts.onlineUsers || 0} />
          <MetricCard label="Connected devices" value={counts.onlineDevices || 0} />
          <MetricCard label="Subscribers" value={counts.subscribers || 0} />
          <MetricCard label="Active subscriptions" value={counts.activeSubscribers || 0} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Smartphone size={18} /> Devices
          </h2>
        </div>
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>IP</th>
                <th>Forwarded</th>
                <th>User agent</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.fingerprint}>
                  <td>{device.user_name || "-"}</td>
                  <td>{device.is_online ? "online" : "offline"}</td>
                  <td dir="ltr">{device.ip_address || "-"}</td>
                  <td dir="ltr">{device.forwarded_for || "-"}</td>
                  <td dir="ltr">{device.user_agent || "-"}</td>
                  <td>{formatUserDateTime(device.last_seen_at)}</td>
                </tr>
              ))}
              {!devices.length && (
                <tr>
                  <td colSpan={6}>No devices yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Users size={18} /> Users
          </h2>
        </div>
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Work time</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.display_name}</td>
                  <td>{user.role}</td>
                  <td>{user.is_online ? "online" : "offline"}</td>
                  <td>{user.work_time_label || workTimeLabel(user.work_time_seconds)}</td>
                  <td>{formatUserDateTime(user.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <WalletCards size={18} /> Plans
          </h2>
          <Field label="Admin password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>
        {isAdmin ? (
          <form onSubmit={savePlans} className="table-scroll compact-table">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Users</th>
                  <th>Monthly</th>
                  <th>Annually</th>
                  <th>Currency</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {planDrafts.map((plan, index) => (
                  <tr key={`${plan.id}-${index}`}>
                    <td>
                      <input
                        value={plan.id || ""}
                        onChange={(event) => updatePlan(index, "id", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={plan.name || ""}
                        onChange={(event) => updatePlan(index, "name", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={plan.users || 1}
                        onChange={(event) => updatePlan(index, "users", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={plan.monthly || 0}
                        onChange={(event) => updatePlan(index, "monthly", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={plan.annually || 0}
                        onChange={(event) => updatePlan(index, "annually", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={plan.currency || "USD"}
                        onChange={(event) => updatePlan(index, "currency", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!plan.active}
                        onChange={(event) => updatePlan(index, "active", event.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="action-row">
              <button
                type="button"
                onClick={() =>
                  setPlanDrafts((current) => [
                    ...current,
                    {
                      id: `plan-${current.length + 1}`,
                      name: "New plan",
                      users: 1,
                      monthly: 0,
                      annually: 0,
                      currency: "USD",
                      active: true,
                    },
                  ])
                }
              >
                <Plus size={17} /> Plan
              </button>
              <button type="submit" className="primary">
                <Save size={17} /> Save plans
              </button>
            </div>
          </form>
        ) : (
          <div className="empty-state">Controller plan editing is admin only.</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Database size={18} /> Subscribers
          </h2>
        </div>
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Users</th>
                <th>Billing</th>
                <th>Plan</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Host</th>
                <th>Tunnel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((row) => {
                const edit = subscriberEdits[row.id] || {};
                return (
                  <tr key={row.id}>
                    <td>{row.company_name}</td>
                    <td>{row.contact_name || row.email || row.phone || "-"}</td>
                    <td>{row.requested_users}</td>
                    <td>{row.billing_cycle}</td>
                    <td>{row.selected_plan_id || "-"}</td>
                    <td>
                      <select
                        value={edit.payment_status ?? row.payment_status}
                        disabled={!isAdmin}
                        onChange={(event) =>
                          setSubscriberEdits((current) => ({
                            ...current,
                            [row.id]: {
                              ...(current[row.id] || {}),
                              payment_status: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="pending">pending</option>
                        <option value="paid">paid</option>
                        <option value="failed">failed</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={edit.subscription_status ?? row.subscription_status}
                        disabled={!isAdmin}
                        onChange={(event) =>
                          setSubscriberEdits((current) => ({
                            ...current,
                            [row.id]: {
                              ...(current[row.id] || {}),
                              subscription_status: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="lead">lead</option>
                        <option value="trial">trial</option>
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </td>
                    <td dir="ltr">{row.local_host || "-"}</td>
                    <td dir="ltr">{row.tunnel_url || row.tunnel_provider || "-"}</td>
                    <td>
                      <button
                        type="button"
                        disabled={!isAdmin || !subscriberEdits[row.id]}
                        onClick={() => saveSubscriber(row.id)}
                      >
                        <Save size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!subscribers.length && (
                <tr>
                  <td colSpan={10}>No subscription requests yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ManagerEventsAdmin({ api, ownerName, adminPassword, setMessage }) {
  const emptyDraft = {
    event_type: "information",
    title: "",
    message: "",
    starts_at: "",
    expires_at: "",
    target_users: "",
    target_companies: "",
    backgroundColor: "#eef6ff",
    color: "#17212b",
    borderColor: "#4387d8",
    offer_price: "",
    offer_details: "",
    in_app_enabled: true,
    windows_enabled: false,
    active: true,
  };
  const [events, setEvents] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);

  const authQuery = new URLSearchParams({
    login: ownerName || "",
    password: adminPassword || "",
  });

  async function loadEvents() {
    if (!ownerName || !adminPassword) return;
    try {
      const data = await api.request(`/api/manager/events?${authQuery.toString()}`);
      setEvents(data?.events || []);
    } catch (error) {
      setMessage?.(`Could not load manager events: ${error.message}`);
    }
  }

  useEffect(() => {
    loadEvents();
  }, [ownerName, adminPassword]);

  async function createEvent(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api.request("/api/manager/events", {
        method: "POST",
        body: JSON.stringify({
          login: ownerName,
          password: adminPassword,
          event_type: draft.event_type,
          title: draft.title,
          message: draft.message,
          starts_at: draft.starts_at ? new Date(draft.starts_at).toISOString() : "",
          expires_at: draft.expires_at ? new Date(draft.expires_at).toISOString() : "",
          target_users: draft.target_users,
          target_companies: draft.target_companies,
          style: {
            backgroundColor: draft.backgroundColor,
            color: draft.color,
            borderColor: draft.borderColor,
          },
          offer_price: draft.offer_price,
          offer_details: draft.offer_details,
          in_app_enabled: draft.in_app_enabled,
          windows_enabled: draft.windows_enabled,
          active: draft.active,
          created_by: ownerName,
        }),
      });
      setEvents((current) => [created, ...current]);
      setDraft(emptyDraft);
      setMessage?.("Manager event created and ready for targeted users.");
    } catch (error) {
      setMessage?.(`Could not create manager event: ${error.message}`);
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  async function toggleEvent(event) {
    setBusy(true);
    try {
      const updated = await api.request(`/api/manager/events/${event.id}`, {
        method: "PUT",
        body: JSON.stringify({
          login: ownerName,
          password: adminPassword,
          active: !event.active,
        }),
      });
      setEvents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  return (
    <section className="manager-admin-panel wide manager-events-admin">
      <h3>Notifications, warnings, and offers</h3>
      <form className="form-grid manager-event-form" onSubmit={createEvent}>
        <Field label="Event type">
          <select
            value={draft.event_type}
            onChange={(event) => setDraft({ ...draft, event_type: event.target.value })}
          >
            <option value="information">Information</option>
            <option value="warning">Warning</option>
            <option value="offer">Offer</option>
          </select>
        </Field>
        <Field label="Custom title">
          <input
            required
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </Field>
        <Field label="Message / details">
          <textarea
            required
            value={draft.message}
            onChange={(event) => setDraft({ ...draft, message: event.target.value })}
          />
        </Field>
        <Field label="Start date/time (optional)">
          <input
            type="datetime-local"
            value={draft.starts_at}
            onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })}
          />
        </Field>
        <Field label="Expiry date/time (optional)">
          <input
            type="datetime-local"
            value={draft.expires_at}
            onChange={(event) => setDraft({ ...draft, expires_at: event.target.value })}
          />
        </Field>
        <Field label="Target users (comma separated; blank = all)">
          <input
            value={draft.target_users}
            onChange={(event) => setDraft({ ...draft, target_users: event.target.value })}
          />
        </Field>
        <Field label="Target companies (comma separated; blank = all)">
          <input
            value={draft.target_companies}
            onChange={(event) =>
              setDraft({ ...draft, target_companies: event.target.value })
            }
          />
        </Field>
        <div className="manager-event-color-grid">
          {[
            ["backgroundColor", "Background"],
            ["color", "Text"],
            ["borderColor", "Border"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="color"
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </Field>
          ))}
        </div>
        {draft.event_type === "offer" && (
          <>
            <Field label="Offer price / value">
              <input
                value={draft.offer_price}
                onChange={(event) => setDraft({ ...draft, offer_price: event.target.value })}
              />
            </Field>
            <Field label="Offer-specific details">
              <input
                value={draft.offer_details}
                onChange={(event) => setDraft({ ...draft, offer_details: event.target.value })}
              />
            </Field>
          </>
        )}
        <div className="manager-event-flags">
          {[
            ["in_app_enabled", "In-app notification"],
            ["windows_enabled", "Windows notification"],
            ["active", "Active"],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={!!draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <button type="submit" className="primary" disabled={busy}>
          <Send size={16} /> Create and send event
        </button>
      </form>
      <div className="manager-event-admin-list">
        {events.map((event) => (
          <article key={event.id}>
            <div>
              <strong>{event.title}</strong>
              <span>{event.event_type} · {event.active ? "active" : "inactive"}</span>
            </div>
            <button type="button" onClick={() => toggleEvent(event)} disabled={busy}>
              {event.active ? "Deactivate" : "Activate"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ManagerPortal({ api, apiBase, setApiBase, setMessage, message }) {
  const [publicData, setPublicData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);
  const [ownerName, setOwnerName] = useState("");
  const [form, setForm] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    requested_users: 3,
    billing_cycle: "monthly",
    selected_plan_id: "",
    payment_method_id: "",
    local_host: "",
    tunnel_provider: "",
    tunnel_url: "",
    notes: "",
  });
  const [adminPassword, setAdminPassword] = useState("");
  const [adminData, setAdminData] = useState(null);
  const [adminSettings, setAdminSettings] = useState(null);
  const [adminPaymentSettings, setAdminPaymentSettings] = useState(null);
  const [adminPlans, setAdminPlans] = useState([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [selectedSubscriberId, setSelectedSubscriberId] = useState("");
  const [companyEdits, setCompanyEdits] = useState({});

  const settings = publicData?.settings || {};
  const plans = publicData?.plans || [];
  const activePlan =
    plans.find((plan) => plan.id === form.selected_plan_id) ||
    plans.find((plan) => Number(plan.users || 0) >= Number(form.requested_users || 1)) ||
    plans[0];
  const methods = settings.paymentMethods || [];
  const selectedMethod =
    methods.find((method) => method.id === form.payment_method_id) || methods[0];
  const planAmount = activePlan
    ? Number(
        form.billing_cycle === "annually"
          ? activePlan.annually || activePlan.monthly
          : activePlan.monthly,
      )
    : 0;
  const planCurrency = activePlan?.currency || "USD";
  const subscribers = adminData?.subscribers || [];
  const selectedSubscriber =
    subscribers.find((subscriber) => String(subscriber.id) === String(selectedSubscriberId)) ||
    subscribers[0] ||
    null;
  const selectedPayments = selectedSubscriber
    ? (adminData?.payments || []).filter(
        (payment) => Number(payment.subscription_id) === Number(selectedSubscriber.id),
      )
    : [];
  const currencies = ["USD"];

  function paymentLast4(payment = {}) {
    const raw = String(
      payment.external_payment_id ||
        payment.payer_email ||
        payment.reference ||
        "",
    ).replace(/\s+/g, "");
    return raw ? raw.slice(-4) : "-";
  }

  const loadPublic = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request("/api/manager/public");
      setPublicData(data);
      setForm((current) => ({
        ...current,
        selected_plan_id:
          current.selected_plan_id || data.plans?.[0]?.id || "",
        payment_method_id:
          current.payment_method_id || data.settings?.paymentMethods?.[0]?.id || "",
      }));
    } catch (error) {
      setMessage?.(`Manager portal failed to load: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, setMessage]);

  useEffect(() => {
    loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    setCompanyEdits({
      free_access_until: selectedSubscriber?.free_access_until
        ? String(selectedSubscriber.free_access_until).slice(0, 10)
        : "",
      subscription_note: selectedSubscriber?.subscription_note || "",
    });
  }, [selectedSubscriber?.id, selectedSubscriber?.free_access_until, selectedSubscriber?.subscription_note]);

  function updateForm(key, value) {
    setCheckoutResult(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function startCheckout(event) {
    event.preventDefault();
    if (!activePlan || !selectedMethod) {
      setMessage?.("Choose a plan and payment method first.");
      return;
    }
    setCheckoutBusy(true);
    try {
      const data = await api.request("/api/payments/create-checkout", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          plan_id: activePlan.id,
          selected_plan_id: activePlan.id,
          payment_method: "paypal",
        }),
      });
      setCheckoutResult(data);
      setMessage?.(
        data.checkout_url
          ? "PayPal checkout created."
          : "PayPal checkout could not be created.",
      );
    } catch (error) {
      setMessage?.(`Could not create payment order: ${error.message}`);
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function loadAdmin(event) {
    event?.preventDefault?.();
    if (!String(ownerName || "").trim() || !adminPassword) {
      setMessage?.("Enter the manager email/name and password.");
      return;
    }
    setAdminBusy(true);
    try {
      const data = await api.request(
        `/api/manager/admin?login=${encodeURIComponent(ownerName)}&password=${encodeURIComponent(adminPassword)}`,
      );
      setAdminData(data);
      setAdminSettings(data.settings || {});
      setAdminPaymentSettings(
        data.paymentSettings || {
          mode: "sandbox",
          currency: "USD",
          paypal: {
            client_id: "",
            secret: "",
            username: "",
            password: "",
          },
        },
      );
      setAdminPlans(data.plans || []);
      setSelectedSubscriberId(data.subscribers?.[0]?.id ? String(data.subscribers[0].id) : "");
      setMessage?.("Manager owner controls loaded.");
    } catch (error) {
      setMessage?.(`Could not open owner controls: ${error.message}`);
    } finally {
      setAdminBusy(false);
    }
  }

  async function saveAdminSettings(event) {
    event.preventDefault();
    setAdminBusy(true);
    try {
      const data = await api.request("/api/manager/settings", {
        method: "PUT",
        body: JSON.stringify({
          login: ownerName,
          password: adminPassword,
          settings: adminSettings,
        }),
      });
      setAdminSettings(data.settings);
      setMessage?.("Manager payment settings saved.");
      await loadPublic();
    } catch (error) {
      setMessage?.(`Could not save manager settings: ${error.message}`);
    } finally {
      setAdminBusy(false);
    }
  }

  async function savePaymentSettings(event) {
    event.preventDefault();
    setAdminBusy(true);
    try {
      const data = await api.request("/api/manager/payment-settings", {
        method: "PUT",
        body: JSON.stringify({
          login: ownerName,
          password: adminPassword,
          mode: adminPaymentSettings?.mode || "sandbox",
          currency: "USD",
          paypal: adminPaymentSettings?.paypal || {},
        }),
      });
      setAdminPaymentSettings({
        ...data,
        paypal: {
          ...(data.paypal || {}),
          secret: "",
          password: "",
        },
      });
      setMessage?.("PayPal credentials saved.");
    } catch (error) {
      setMessage?.(`Could not save PayPal credentials: ${error.message}`);
    } finally {
      setAdminBusy(false);
    }
  }

  async function testPayPalSettings() {
    setAdminBusy(true);
    try {
      const data = await api.request("/api/manager/payment-settings/paypal/test", {
        method: "POST",
        body: JSON.stringify({
          login: ownerName,
          password: adminPassword,
          mode: adminPaymentSettings?.mode || "sandbox",
        }),
      });
      setMessage?.(data.message || "PayPal connection successful.");
    } catch (error) {
      setMessage?.(`PayPal test failed: ${error.message}`);
    } finally {
      setAdminBusy(false);
    }
  }

  async function saveAdminPlans(event) {
    event.preventDefault();
    setAdminBusy(true);
    try {
      const data = await api.request("/api/subscription/plans", {
        method: "PUT",
        body: JSON.stringify({ login: ownerName, password: adminPassword, plans: adminPlans }),
      });
      setAdminPlans(data.plans || []);
      setMessage?.("Manager plans saved.");
      await loadPublic();
    } catch (error) {
      setMessage?.(`Could not save plans: ${error.message}`);
    } finally {
      setAdminBusy(false);
    }
  }

  async function saveCompanyOverride() {
    if (!selectedSubscriber?.id) return;
    setAdminBusy(true);
    try {
      const updated = await api.request(`/api/subscriptions/${selectedSubscriber.id}`, {
        method: "PUT",
        body: JSON.stringify({
          login: ownerName,
          password: adminPassword,
          free_access_until: companyEdits.free_access_until
            ? new Date(`${companyEdits.free_access_until}T23:59:59`).toISOString()
            : "",
          subscription_note: companyEdits.subscription_note || "",
        }),
      });
      setAdminData((current) => ({
        ...(current || {}),
        subscribers: (current?.subscribers || []).map((subscriber) =>
          subscriber.id === updated.id ? { ...subscriber, ...updated } : subscriber,
        ),
      }));
      setMessage?.(
        companyEdits.free_access_until
          ? `Free access set until ${companyEdits.free_access_until}.`
          : "Free access override cleared.",
      );
    } catch (error) {
      setMessage?.(`Could not save company override: ${error.message}`);
    } finally {
      setAdminBusy(false);
    }
  }

  function updateAdminSetting(key, value) {
    setAdminSettings((current) => ({ ...(current || {}), [key]: value }));
  }

  function updatePaymentSetting(key, value) {
    setAdminPaymentSettings((current) => ({ ...(current || {}), [key]: value }));
  }

  function updatePayPalSetting(key, value) {
    setAdminPaymentSettings((current) => ({
      ...(current || {}),
      paypal: {
        ...((current || {}).paypal || {}),
        [key]: value,
      },
    }));
  }

  function updateAdminArray(section, index, key, value) {
    setAdminSettings((current) => {
      const rows = [...((current || {})[section] || [])];
      rows[index] = { ...(rows[index] || {}), [key]: value };
      return { ...(current || {}), [section]: rows };
    });
  }

  function addAdminArrayRow(section, row) {
    setAdminSettings((current) => ({
      ...(current || {}),
      [section]: [...((current || {})[section] || []), row],
    }));
  }

  function updateAdminPlan(index, key, value) {
    setAdminPlans((current) =>
      current.map((plan, itemIndex) =>
        itemIndex === index ? { ...plan, [key]: value } : plan,
      ),
    );
  }

  if (!adminData) {
    return (
      <main className="manager-page manager-locked" dir="ltr">
        <header className="manager-header">
          <div className="manager-brand">
            <AppBrandMark small />
            <div>
              <strong>Accounting Management</strong>
              <span>/manager owner access</span>
            </div>
        </div>
        <div className="manager-actions">
            <button type="button" onClick={loadPublic} disabled={loading}>
              <RefreshCw size={17} /> Refresh
            </button>
          </div>
        </header>
        {message && <div className="manager-notice">{message}</div>}
        <section className="manager-section manager-login-section">
          <div className="manager-section-head">
            <div>
              <span>Owner only</span>
              <h1>Manager control center</h1>
            </div>
            <strong>Protected</strong>
          </div>
          <form className="manager-owner-login manager-owner-login-large" onSubmit={loadAdmin}>
            <Field label="Owner email or name">
              <input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                autoComplete="username"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <button type="submit" className="primary" disabled={adminBusy}>
              <KeyRound size={17} /> Open manager
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="manager-page" dir="ltr">
      <header className="manager-header">
        <div className="manager-brand">
          <AppBrandMark small />
          <div>
            <strong>{settings.businessName || "Accounting Management"}</strong>
            <span>{settings.publicUrl || "/manager"}</span>
          </div>
        </div>
        <div className="manager-actions">
          <button type="button" onClick={loadPublic} disabled={loading}>
            <RefreshCw size={17} /> Refresh
          </button>
        </div>
      </header>

      <section className="manager-hero">
        <div>
          <span className="manager-kicker">Owner manager</span>
          <h1>Accounting Management owner console</h1>
          <p>Plans, payment methods, subscriber companies, activation, and security settings.</p>
          <div className="manager-hero-actions">
            <a href="#manager-owner">Owner settings</a>
          </div>
        </div>
        <div className="manager-status-panel">
          <MetricCard label="Plans" value={plans.length || 0} />
          <MetricCard label="Payment methods" value={methods.length || 0} />
          <MetricCard label="Version" value={`v${APP_DISPLAY_VERSION}`} />
        </div>
      </section>

      {message && <div className="manager-notice">{message}</div>}

      {false && (
      <section className="manager-section" id="manager-checkout">
        <div className="manager-section-head">
          <div>
            <span>For customers</span>
            <h2>Subscribe and pay</h2>
          </div>
          <strong>
            {planAmount ? `${money(planAmount)} ${planCurrency}` : "Choose a plan"}
          </strong>
        </div>

        <div className="manager-plan-grid">
          {plans.map((plan) => (
            <button
              type="button"
              key={plan.id}
              className={activePlan?.id === plan.id ? "manager-plan active" : "manager-plan"}
              onClick={() => {
                updateForm("selected_plan_id", plan.id);
                updateForm("requested_users", plan.users || 1);
              }}
            >
              <span>{plan.name}</span>
              <strong>{plan.users} users</strong>
              <small>
                {money(plan.monthly)} / month · {money(plan.annually)} / year {plan.currency}
              </small>
            </button>
          ))}
        </div>

        <form className="manager-checkout-grid" onSubmit={startCheckout}>
          <div className="manager-form-panel">
            <h3>Company details</h3>
            <div className="form-grid">
              <Field label="Company">
                <input
                  value={form.company_name}
                  onChange={(event) => updateForm("company_name", event.target.value)}
                  required
                />
              </Field>
              <Field label="Contact">
                <input
                  value={form.contact_name}
                  onChange={(event) => updateForm("contact_name", event.target.value)}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => updateForm("email", event.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(event) => updateForm("phone", event.target.value)}
                />
              </Field>
              <Field label="Country">
                <input
                  value={form.country}
                  onChange={(event) => updateForm("country", event.target.value)}
                />
              </Field>
              <Field label="City">
                <input
                  value={form.city}
                  onChange={(event) => updateForm("city", event.target.value)}
                />
              </Field>
              <Field label="Users">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.requested_users}
                  onChange={(event) => updateForm("requested_users", event.target.value)}
                />
              </Field>
              <Field label="Billing">
                <select
                  value={form.billing_cycle}
                  onChange={(event) => updateForm("billing_cycle", event.target.value)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annually">Annually</option>
                </select>
              </Field>
              <Field label="Local host">
                <input
                  dir="ltr"
                  value={form.local_host}
                  placeholder="https://customer-domain.com"
                  onChange={(event) => updateForm("local_host", event.target.value)}
                />
              </Field>
              <Field label="Tunnel URL">
                <input
                  dir="ltr"
                  value={form.tunnel_url}
                  placeholder="Cloudflare / ngrok / custom"
                  onChange={(event) => updateForm("tunnel_url", event.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="manager-form-panel">
            <h3>Payment method</h3>
            <div className="manager-methods">
              {methods.map((method) => (
                <label
                  key={method.id}
                  className={
                    selectedMethod?.id === method.id
                      ? "manager-method active"
                      : "manager-method"
                  }
                >
                  <input
                    type="radio"
                    name="payment_method"
                    checked={selectedMethod?.id === method.id}
                    onChange={() => updateForm("payment_method_id", method.id)}
                  />
                  <span>{method.label}</span>
                  <small>{method.instructions}</small>
                </label>
              ))}
            </div>
            <button type="submit" className="primary manager-pay-button" disabled={checkoutBusy}>
              <WalletCards size={18} /> Create payment order
            </button>
          </div>
        </form>

        {checkoutResult && (
          <section className="manager-result">
            <div>
              <span>Payment reference</span>
              <strong>{checkoutResult.payment_id || "-"}</strong>
              <small>
                Status: {checkoutResult.payment?.status} · Amount:{" "}
                {money(planAmount)} {planCurrency}
              </small>
            </div>
            {checkoutResult.checkout_url ? (
              <a
                className="manager-checkout-link"
                href={checkoutResult.checkout_url}
                target="_blank"
                rel="noreferrer"
              >
                Open PayPal checkout
              </a>
            ) : (
              <span className="manager-muted">
                PayPal did not return a checkout URL.
              </span>
            )}
          </section>
        )}
      </section>
      )}

      <section className="manager-section" id="manager-owner">
        <div className="manager-section-head">
          <div>
            <span>For owner</span>
            <h2>PayPal payments and activation</h2>
          </div>
          {!adminSettings && <form className="manager-owner-login" onSubmit={loadAdmin}>
            <input
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              aria-label="Owner email or name"
            />
            <input
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              aria-label="Password"
            />
            <button type="submit" disabled={adminBusy}>
              <KeyRound size={17} /> Open
            </button>
          </form>}
        </div>

        {adminSettings && (
          <div className="manager-admin-grid">
            <form className="manager-admin-panel" onSubmit={savePaymentSettings}>
              <h3>PayPal Credentials</h3>
              <div className="form-grid">
                <Field label="Mode">
                  <select
                    value={adminPaymentSettings?.mode || "sandbox"}
                    onChange={(event) => updatePaymentSetting("mode", event.target.value)}
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="live">Live</option>
                  </select>
                </Field>
                <Field label="Currency">
                  <input value="USD" readOnly />
                </Field>
                <Field label="PayPal API Key / Client ID">
                  <input
                    dir="ltr"
                    value={adminPaymentSettings?.paypal?.client_id || ""}
                    onChange={(event) => updatePayPalSetting("client_id", event.target.value)}
                  />
                </Field>
                <Field label="PayPal Secret">
                  <input
                    type="password"
                    dir="ltr"
                    placeholder={adminPaymentSettings?.paypal?.secret_masked || ""}
                    value={adminPaymentSettings?.paypal?.secret || ""}
                    onChange={(event) => updatePayPalSetting("secret", event.target.value)}
                  />
                </Field>
                <Field label="PayPal Account Username">
                  <input
                    dir="ltr"
                    value={adminPaymentSettings?.paypal?.username || ""}
                    onChange={(event) => updatePayPalSetting("username", event.target.value)}
                  />
                </Field>
                <Field label="PayPal Account Password">
                  <input
                    type="password"
                    dir="ltr"
                    placeholder={adminPaymentSettings?.paypal?.password_masked || ""}
                    value={adminPaymentSettings?.paypal?.password || ""}
                    onChange={(event) => updatePayPalSetting("password", event.target.value)}
                  />
                </Field>
              </div>
              <div className="action-row">
                <button type="button" onClick={testPayPalSettings} disabled={adminBusy}>
                  <Check size={17} /> Test PayPal Connection
                </button>
                <button type="submit" className="primary" disabled={adminBusy}>
                  <Save size={17} /> Save PayPal credentials
                </button>
              </div>
            </form>

            <form className="manager-admin-panel" onSubmit={saveAdminSettings}>
              <h3>Owner security</h3>
              <div className="form-grid">
                {[
                  ["businessName", "Business name"],
                  ["sellerName", "Seller name"],
                  ["ownerLoginName", "Owner login name"],
                  ["ownerLoginEmail", "Owner login email"],
                  ["ownerPassword", "Owner password"],
                  ["supportEmail", "Support email"],
                  ["supportPhone", "Support phone"],
                  ["publicUrl", "Manager URL"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type={key === "ownerPassword" ? "password" : "text"}
                      dir={key.includes("Url") || key.includes("Email") ? "ltr" : "auto"}
                      value={adminSettings[key] || ""}
                      onChange={(event) => updateAdminSetting(key, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
              <button type="submit" className="primary" disabled={adminBusy}>
                <Save size={17} /> Save owner settings
              </button>
            </form>

            <form className="manager-admin-panel" onSubmit={saveAdminPlans}>
              <h3>Plans and prices</h3>
              {(adminPlans || []).map((plan, index) => (
                <div className="manager-admin-repeat compact" key={`${plan.id}-${index}`}>
                  {[
                    ["id", "ID"],
                    ["name", "Name"],
                    ["users", "Users"],
                    ["monthly", "Monthly"],
                    ["annually", "Annually"],
                    ["currency", "Currency"],
                  ].map(([key, label]) => (
                    <Field key={key} label={label}>
                      {key === "currency" ? (
                        <select
                          value={plan.currency || "USD"}
                          onChange={(event) =>
                            updateAdminPlan(index, key, event.target.value)
                          }
                        >
                          {currencies.map((currency) => (
                            <option key={currency} value={currency}>
                              {currency}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={["users", "monthly", "annually"].includes(key) ? "number" : "text"}
                          min={key === "users" ? "1" : "0"}
                          value={plan[key] ?? ""}
                          onChange={(event) =>
                            updateAdminPlan(index, key, event.target.value)
                          }
                        />
                      )}
                    </Field>
                  ))}
                  <label className="check-tile">
                    <input
                      type="checkbox"
                      checked={!!plan.active}
                      onChange={(event) =>
                        updateAdminPlan(index, "active", event.target.checked)
                      }
                    />
                    <span>Active</span>
                  </label>
                </div>
              ))}
              <div className="action-row">
                <button
                  type="button"
                  onClick={() =>
                    setAdminPlans((current) => [
                      ...current,
                      {
                        id: `plan-${current.length + 1}`,
                        name: "New plan",
                        users: 1,
                        monthly: 0,
                        annually: 0,
                        currency: "USD",
                        active: true,
                      },
                    ])
                  }
                >
                  <Plus size={17} /> Add plan
                </button>
                <button type="submit" className="primary" disabled={adminBusy}>
                  <Save size={17} /> Save plans
                </button>
              </div>
            </form>

            <ManagerEventsAdmin
              api={api}
              ownerName={ownerName}
              adminPassword={adminPassword}
              setMessage={setMessage}
            />

            <section className="manager-admin-panel wide">
              <h3>Companies</h3>
              <div className="table-scroll compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Users</th>
                      <th>Plan</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Host</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((subscriber) => (
                      <tr
                        key={subscriber.id}
                        className={
                          String(selectedSubscriber?.id) === String(subscriber.id)
                            ? "selected-row"
                            : ""
                        }
                        onClick={() => setSelectedSubscriberId(String(subscriber.id))}
                      >
                        <td>{subscriber.company_name || "-"}</td>
                        <td>{subscriber.contact_name || subscriber.email || subscriber.phone || "-"}</td>
                        <td>
                          {Number(subscriber.active_users || 0)} /{" "}
                          {Number(subscriber.requested_users || 0)}
                        </td>
                        <td>{subscriber.selected_plan_id || "-"}</td>
                        <td>{subscriber.payment_status || "-"}</td>
                        <td>{subscriber.subscription_status || "-"}</td>
                        <td dir="ltr">{subscriber.tunnel_url || subscriber.local_host || "-"}</td>
                      </tr>
                    ))}
                    {!subscribers.length && (
                      <tr>
                        <td colSpan={7}>No companies yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {selectedSubscriber && (
                <div className="manager-company-detail">
                  <div>
                    <span>Company</span>
                    <strong>{selectedSubscriber.company_name || "-"}</strong>
                    <small>
                      {[
                        selectedSubscriber.region,
                        selectedSubscriber.city,
                        selectedSubscriber.country,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "No region saved"}
                    </small>
                  </div>
                  <div>
                    <span>Person in charge</span>
                    <strong>{selectedSubscriber.contact_name || "-"}</strong>
                    <small>
                      {[selectedSubscriber.email, selectedSubscriber.phone]
                        .filter(Boolean)
                        .join(" / ") || "No contact saved"}
                    </small>
                  </div>
                  <div>
                    <span>Website and address</span>
                    <strong dir="ltr">{selectedSubscriber.company_website || "-"}</strong>
                    <small>{selectedSubscriber.company_address || "No company address saved"}</small>
                  </div>
                  <div>
                    <span>Subscription limit</span>
                    <strong>
                      {Number(selectedSubscriber.active_users || 0)} active /{" "}
                      {Number(selectedSubscriber.requested_users || 0)} allowed
                    </strong>
                    <small>
                      {Number(selectedSubscriber.active_users || 0) >
                      Number(selectedSubscriber.requested_users || 0)
                        ? "Over limit: suspend until upgrade"
                        : "Within selected plan"}
                    </small>
                  </div>
                  <div className="manager-company-override">
                    <span>Free access override</span>
                    <input
                      type="date"
                      value={companyEdits.free_access_until || ""}
                      onChange={(event) =>
                        setCompanyEdits((current) => ({
                          ...current,
                          free_access_until: event.target.value,
                        }))
                      }
                    />
                    <small>
                      {selectedSubscriber.free_access_until
                        ? `Current free access until ${String(selectedSubscriber.free_access_until).slice(0, 10)}`
                        : "No free-access override"}
                    </small>
                  </div>
                  <div className="manager-company-override">
                    <span>Owner note</span>
                    <input
                      value={companyEdits.subscription_note || ""}
                      onChange={(event) =>
                        setCompanyEdits((current) => ({
                          ...current,
                          subscription_note: event.target.value,
                        }))
                      }
                    />
                    <button type="button" onClick={saveCompanyOverride} disabled={adminBusy}>
                      <Save size={15} /> Save access
                    </button>
                  </div>
                  <div>
                    <span>Payment history</span>
                    <strong>{selectedPayments.length} payment(s)</strong>
                    <small>
                      {selectedPayments[0]
                        ? `${selectedPayments[0].method || selectedPayments[0].provider || "method"} ending ${paymentLast4(selectedPayments[0])}`
                        : "No payments yet"}
                    </small>
                  </div>
                  <div>
                    <span>Server logs and errors</span>
                    <strong>No critical logs</strong>
                    <small>Company device/server logs will appear here when forwarded.</small>
                  </div>
                </div>
              )}
            </section>

            <section className="manager-admin-panel wide">
              <h3>Payments and subscriptions</h3>
              <div className="table-scroll compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Company</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(adminData.payments || []).map((payment) => (
                      <tr key={payment.id}>
                        <td dir="ltr">{payment.reference}</td>
                        <td>{payment.company_name || "-"}</td>
                        <td>{payment.method || payment.provider || "-"}</td>
                        <td>
                          {money(payment.amount)} {payment.currency}
                        </td>
                        <td>{payment.status}</td>
                        <td>{formatUserDateTime(payment.created_at)}</td>
                      </tr>
                    ))}
                    {!adminData.payments?.length && (
                      <tr>
                        <td colSpan={6}>No payments yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function DashboardBarChart({ title, rows = [], labelKey, valueKey, color = "#4387d8" }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  return (
    <section className="dashboard-chart-card">
      <h3>{title}</h3>
      <div className="dashboard-bars">
        {!rows.length && <div className="empty-state">لا توجد بيانات في هذه الفترة.</div>}
        {rows.slice(-12).map((row, index) => (
          <div className="dashboard-bar-row" key={`${row[labelKey]}-${index}`}>
            <span title={String(row[labelKey] || "")}>{row[labelKey]}</span>
            <div>
              <i
                style={{
                  width: `${Math.max(2, (Number(row[valueKey] || 0) / max) * 100)}%`,
                  background: row.color || color,
                }}
              />
            </div>
            <strong>{money(row[valueKey])}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardCircle({ label, value, tone }) {
  return (
    <div className={`dashboard-circle ${tone}`}>
      <div>
        <strong>{money(value)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function DashboardAnalytics({ data, range, setRange, from, setFrom, to, setTo }) {
  if (!data) return <section className="panel"><LoadingOverlay compact /></section>;
  const totals = data.totals || {};
  const paidVsUnpaid = [
    { label: "مدفوع من العملاء", amount: totals.paid || 0, color: "#20a464" },
    { label: "مطلوب سداده - الفواتير المعتمدة", amount: totals.invoiced || 0, color: "#dc3f45" },
  ];
  return (
    <section className="panel dashboard-analytics-panel">
      <div className="panel-head">
        <h2>
          <Activity size={19} /> التحليلات المالية والتشغيلية
        </h2>
        <div className="dashboard-range-filters">
          {[
            ["lifetime", "كل المدة"],
            ["year", "السنة الحالية"],
            ["month", "الشهر الحالي"],
            ["custom", "فترة مخصصة"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={range === value ? "active" : ""}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {range === "custom" && (
        <div className="dashboard-custom-range">
          <Field label="من">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="إلى">
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
      )}
      <div className="dashboard-circle-row">
        <DashboardCircle
          label="المدفوع من العملاء"
          value={totals.paid}
          tone="paid"
        />
        <DashboardCircle
          label="إجمالي الفواتير المعتمدة المطلوب سدادها"
          value={totals.invoiced}
          tone="due"
        />
      </div>
      <div className="metric-grid dashboard-financial-metrics">
        <MetricCard label="إجمالي المدفوع من العملاء" value={money(totals.paid)} />
        <MetricCard label="المطلوب سداده - الفواتير المعتمدة" value={money(totals.invoiced)} />
        <MetricCard label="إجمالي غير المدفوع الحقيقي" value={money(totals.unpaid)} />
        <MetricCard label="المتأخر غير المدفوع" value={money(totals.overdue)} />
        <MetricCard label="إجمالي الفواتير" value={money(totals.invoiced)} />
        <MetricCard label="مدفوع مدى الحياة" value={money(data.lifetime?.paid)} />
        <MetricCard label="مدفوع السنة" value={money(data.yearly?.paid)} />
        <MetricCard label="مدفوع الشهر" value={money(data.monthly?.paid)} />
      </div>
      <div className="dashboard-chart-grid">
        <DashboardBarChart
          title="المدفوع مقابل إجمالي الفواتير المعتمدة"
          rows={paidVsUnpaid}
          labelKey="label"
          valueKey="amount"
          color="#2f9e64"
        />
        <DashboardBarChart
          title="الفواتير حسب الشهر"
          rows={data.invoices_by_month}
          labelKey="month"
          valueKey="amount"
          color="#4387d8"
        />
        <DashboardBarChart
          title="المدفوعات حسب الشهر"
          rows={data.payments_by_month}
          labelKey="month"
          valueKey="amount"
          color="#2f9e64"
        />
        <DashboardBarChart
          title="اتجاه التحصيل النقدي"
          rows={data.cash_collection_trend}
          labelKey="month"
          valueKey="amount"
          color="#8e5bd9"
        />
        <DashboardBarChart
          title="أعمار الديون"
          rows={data.aging}
          labelKey="label"
          valueKey="amount"
          color="#d28a00"
        />
        <DashboardBarChart
          title="غير المدفوع حسب العميل"
          rows={data.customers}
          labelKey="customer"
          valueKey="unpaid"
          color="#d94b4b"
        />
        <DashboardBarChart
          title="المدفوع حسب العميل"
          rows={data.customers}
          labelKey="customer"
          valueKey="paid"
          color="#2f9e64"
        />
      </div>
    </section>
  );
}

function Dashboard(props) {
  const { api, setMessage, onOpenDocument, focus, ...workspaceProps } = props;
  const [analyticsRange, setAnalyticsRange] = useState("lifetime");
  const [analyticsFrom, setAnalyticsFrom] = useState("");
  const [analyticsTo, setAnalyticsTo] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const dashboardWorkflow = ["offer", "invoice", "contractor"].includes(
    workspaceProps.context?.workflowId,
  )
    ? workspaceProps.context.workflowId
    : "offer";

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ range: analyticsRange });
    if (analyticsRange === "custom") {
      if (analyticsFrom) query.set("from", analyticsFrom);
      if (analyticsTo) query.set("to", analyticsTo);
    }
    api.request(`/api/dashboard/analytics?${query.toString()}`)
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch((error) => {
        if (!cancelled) setMessage(`تعذر تحميل تحليلات لوحة التحكم: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    analyticsFrom,
    analyticsRange,
    analyticsTo,
    api,
    setMessage,
    workspaceProps.refreshKey,
  ]);

  return (
    <div className="page-stack">
      <button
        type="button"
        className="dashboard-analytics-toggle"
        aria-expanded={analyticsOpen}
        onClick={() => setAnalyticsOpen((current) => !current)}
      >
        <Activity size={19} />
        التحليلات المالية والتشغيلية
        <span>{analyticsOpen ? "إخفاء" : "عرض"}</span>
      </button>
      {analyticsOpen && (
        <DashboardAnalytics
          data={analytics}
          range={analyticsRange}
          setRange={setAnalyticsRange}
          from={analyticsFrom}
          setFrom={setAnalyticsFrom}
          to={analyticsTo}
          setTo={setAnalyticsTo}
        />
      )}
      <CustomerExplorer
        api={api}
        setMessage={setMessage}
        onOpenDocument={onOpenDocument}
        focus={focus}
      />
      <ReportWorkspace
        {...workspaceProps}
        workflowId={dashboardWorkflow}
        locked={false}
        compact
        hideHeading
        api={api}
        setMessage={setMessage}
        onOpenDocument={onOpenDocument}
      />
    </div>
  );
}

function CustomerExplorer({ api, setMessage, onOpenDocument, focus }) {
  const [search, setSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [customers, setCustomers] = useState([]);
  const [partyId, setPartyId] = useState("");
  const [overview, setOverview] = useState(null);
  const [customerSuggestOpen, setCustomerSuggestOpen] = useState(false);
  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(partyId),
  );
  const shownCustomers = customers.slice(0, 12);

  function chooseCustomer(customer) {
    setSearch(customer.display_name || customer.base_name || "");
    setPartyId(customer.id ? String(customer.id) : "");
    setCustomerSuggestOpen(false);
  }

  useEffect(() => {
    if (!focus?.id && !focus?.name) return;
    setSearch(focus.name || "");
    setPartyId(focus.id ? String(focus.id) : "");
  }, [focus?.id, focus?.name, focus?.stamp]);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomers() {
      try {
        const query = new URLSearchParams({ role: "customer" });
        if (search) query.set("q", search);
        const data = await api.request(`/api/parties?${query.toString()}`);
        if (!cancelled) {
          setCustomers(data || []);
          const idSearch = String(search || "").trim();
          if (idSearch && /^\d+/.test(idSearch) && data?.length === 1) {
            setPartyId(String(data[0].id));
          }
        }
      } catch (error) {
      if (!cancelled && !error?.paymentRequired && error?.status !== 402)
        setMessage(`تعذر تحميل العملاء: ${error.message}`);
      }
    }
    loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [api, search, setMessage]);

  useEffect(() => {
    let cancelled = false;
    async function loadOverview() {
      const query = new URLSearchParams();
      if (partyId) query.set("party_id", partyId);
      else if (search.trim()) query.set("name", search.trim());
      else {
        setOverview(null);
        return;
      }
      try {
        const data = await api.request(
          `/api/customer-overview?${query.toString()}`,
        );
        if (!cancelled) setOverview(data);
      } catch (error) {
        if (!cancelled)
          setMessage(`تعذر تحميل بيانات العميل: ${error.message}`);
      }
    }
    loadOverview();
    return () => {
      cancelled = true;
    };
  }, [api, partyId, search, setMessage]);

  const docLine = (doc) =>
    `${doc.operation_no || doc.document_no || "-"} · ${doc.project || "بدون مشروع"} · ${money(doc.net_total || doc.paid_total || 0)}`;
  function activateDoc(doc, payment = false) {
    setMessage(
      `جاري فتح ${payment ? "التحصيل" : documentTypeLabel(doc.document_type)} ${doc.operation_no || doc.document_no || ""}...`,
    );
    onOpenDocument?.(doc, overview?.party);
  }

  function openDocHref(doc = {}) {
    const params = new URLSearchParams({
      id: String(doc.id || ""),
      type: doc.document_type || "",
      status: doc.status || "",
      operation_no: doc.operation_no || "",
      document_no: String(doc.document_no || ""),
      project: doc.project || "",
      building_unit: doc.building_unit || "",
      party_id: String(overview?.party?.id || ""),
      party_name:
        overview?.party?.display_name || overview?.party?.base_name || "",
      party_base: overview?.party?.base_name || "",
      party_category: overview?.party?.category || "",
    });
    return `#open-document?${params.toString()}`;
  }

  const openDocButton = (doc, { payment = false } = {}) => (
    <a
      href={openDocHref(doc)}
      className={payment ? "tree-link payment-link" : "tree-link"}
      title="افتح هذا البند للمراجعة أو التعديل"
      onClick={(event) => {
        event.preventDefault();
        activateDoc(doc, payment);
      }}
    >
      <span>
        {payment
          ? `تحصيل - ${doc.operation_no || doc.document_no || "-"} · ${doc.project || "عام"} · ${money(doc.paid_total)}`
          : docLine(doc)}
      </span>
      <small>{payment ? "تحصيل" : statusLabel(doc.status)}</small>
    </a>
  );

  const openStatementButton = (row) => {
    const doc = {
      id: `statement-${row.project || "global"}`,
      document_type: "statement",
      status: "approved",
      project: row.project || "",
      party_id: overview?.party?.id,
      customer_name:
        overview?.party?.display_name || overview?.party?.base_name || "",
    };
    return (
      <a
        href={openDocHref(doc)}
        className="tree-link statement-link"
        title="افتح كشف حساب هذا المشروع للمعاينة والطباعة والتصدير"
        onClick={(event) => {
          event.preventDefault();
          activateDoc(doc);
        }}
      >
        <span>
          {row.project || "عام"} · الرصيد {money(row.balance)}
        </span>
        <small>فواتير معتمدة + تحصيل</small>
      </a>
    );
  };

  return (
    <section
      className="panel customer-explorer"
      title="بحث شامل عن كل بيانات العميل من قاعدة البيانات"
    >
      <div className="panel-head">
        <h2>بحث بيانات عميل</h2>
        {overview?.party && (
          <span className="user-chip">ID {overview.party.id}</span>
        )}
      </div>
      <div className="customer-search-row">
        <DocumentIdSearch
          api={api}
          value={documentSearch}
          onChange={setDocumentSearch}
          onSelect={(doc) => {
            const party = {
              id: doc.party_id,
              display_name: doc.customer_name || doc.display_name || "",
              base_name:
                doc.base_name || doc.customer_name || doc.display_name || "",
            };
            setSearch(party.display_name || "");
            if (party.id) setPartyId(String(party.id));
            setMessage?.(
              party.display_name
                ? `تم فتح شجرة العميل المرتبط بالمستند: ${party.display_name}`
                : "تم اختيار المستند. اختر العميل المرتبط لعرض الشجرة",
            );
          }}
          title="اكتب رقم المستند أو ID لفتح شجرة العميل المرتبط به"
        />
        <Field label="اكتب أو اختر العميل">
          {customerSuggestOpen && shownCustomers.length > 0 && (
            <div className="inline-suggestions customer-suggestions">
              {shownCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    chooseCustomer(customer);
                  }}
                >
                  <strong>{customer.display_name || customer.base_name}</strong>
                  <small>ID {customer.id}</small>
                </button>
              ))}
            </div>
          )}
          <input
            value={search}
            onFocus={() => setCustomerSuggestOpen(true)}
            onBlur={() =>
              window.setTimeout(() => setCustomerSuggestOpen(false), 300)
            }
            onChange={(event) => {
              const nextSearch = event.target.value;
              setSearch(nextSearch);
              setCustomerSuggestOpen(true);
              const matched = customers.find(
                (customer) =>
                  customer.display_name === nextSearch ||
                  customer.base_name === nextSearch,
              );
              setPartyId(matched?.id ? String(matched.id) : "");
            }}
            placeholder="اسم العميل"
            autoComplete="off"
            title="ابحث باسم العميل، ثم اختر من القائمة لعرض كل بياناته"
          />
        </Field>
        <Field label="عميل محفوظ">
          <select
            value={partyId}
            onChange={(event) => {
              setPartyId(event.target.value);
              const party = customers.find(
                (customer) => String(customer.id) === event.target.value,
              );
              if (party) setSearch(party.display_name || party.base_name || "");
            }}
            title="اختيار عميل من قاعدة العملاء"
          >
            <option value="">--</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.display_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {overview?.party ? (
        <div className="customer-tree">
          <details open>
            <summary>Projects</summary>
            {(overview.projects || []).map((project) => (
              <details open key={project.name || "بدون مشروع"}>
                <summary>
                  {project.name || "بدون مشروع"}{" "}
                  <span>{money(project.total)}</span>
                </summary>
                <ul>
                  {(project.documents || []).map((doc) => (
                    <li key={doc.id}>{openDocButton(doc)}</li>
                  ))}
                </ul>
              </details>
            ))}
          </details>
          <details open>
            <summary>Price offers</summary>
            <ul>
              {(overview.priceOffers || []).map((doc) => (
                <li key={doc.id}>{openDocButton(doc)}</li>
              ))}
            </ul>
          </details>
          <details open>
            <summary>Invoices</summary>
            <ul>
              {(overview.invoices || []).map((doc) => (
                <li key={doc.id}>{openDocButton(doc)}</li>
              ))}
            </ul>
          </details>
          <details open>
            <summary>Payments</summary>
            <ul>
              {(overview.payments || []).map((doc) => (
                <li key={doc.id}>{openDocButton(doc, { payment: true })}</li>
              ))}
            </ul>
          </details>
          <details open>
            <summary>Statements</summary>
            <ul>
              {(overview.statements || []).map((row) => (
                <li key={row.project || "global"}>
                  {openStatementButton(row)}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <div className="empty-state tight">
          {selectedCustomer
            ? "لا توجد بيانات مرتبطة بعد"
            : "اختر عميل لعرض الشجرة"}
        </div>
      )}
    </section>
  );
}

function ContractorsView({ api, currentUser, setMessage, refreshKey }) {
  const empty = {
    base_name: "",
    display_name: "",
    phone: "",
    email: "",
    address: "",
    tax_no: "",
    notes: "",
  };
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const canManage = canUser(currentUser, "can_edit_company_settings");

  const load = useCallback(async () => {
    const query = new URLSearchParams({ role: "contractor" });
    if (search) query.set("q", search);
    const data = await api.request(`/api/parties?${query.toString()}`);
    setRows(data || []);
  }, [api, search]);

  useEffect(() => {
    load().catch((error) => setMessage(`تعذر تحميل المقاولين: ${error.message}`));
  }, [load, refreshKey, setMessage]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const row = await api.request(
        editingId ? `/api/parties/${editingId}` : "/api/parties",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            ...draft,
            role: "contractor",
            category: "corporate",
            requester_user_id: currentUser?.id,
          }),
        },
      );
      setRows((current) =>
        editingId
          ? current.map((item) => (item.id === row.id ? row : item))
          : [row, ...current],
      );
      setDraft(empty);
      setEditingId(null);
      setMessage(editingId ? "تم تعديل بيانات المقاول." : "تم إضافة المقاول.");
    } catch (error) {
      setMessage(`تعذر حفظ المقاول: ${error.message}`);
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  async function remove(row) {
    setBusy(true);
    try {
      await api.request(`/api/parties/${row.id}`, {
        method: "DELETE",
        body: JSON.stringify({ requester_user_id: currentUser?.id }),
      });
      setRows((current) => current.filter((item) => item.id !== row.id));
      if (editingId === row.id) {
        setEditingId(null);
        setDraft(empty);
      }
      setMessage(`تم حذف سجل المقاول ${row.display_name}.`);
    } catch (error) {
      setMessage(`تعذر حذف المقاول: ${error.message}`);
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  return (
    <section className="panel contractors-management-panel">
      <ConfirmationLayer
        dialog={
          pendingDelete
            ? {
                title: "حذف سجل المقاول",
                message: `سيتم حذف سجل ${pendingDelete.display_name}. المستندات القديمة ستحتفظ بالاسم المسجل داخلها.`,
                confirmLabel: "حذف المقاول",
                danger: true,
              }
            : null
        }
        onResult={(confirmed) => {
          const row = pendingDelete;
          setPendingDelete(null);
          if (confirmed) remove(row);
          else restoreInputInteractivity();
        }}
      />
      <div className="panel-head">
        <h2>
          <Building2 size={19} /> إدارة المقاولين
        </h2>
        <div className="inline-field contractor-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو ID"
          />
        </div>
      </div>
      {canManage && (
        <form className="form-grid contractor-entry-form" onSubmit={save}>
          {[
            ["base_name", "اسم المقاول"],
            ["display_name", "الاسم الظاهر"],
            ["phone", "الهاتف"],
            ["email", "البريد الإلكتروني"],
            ["address", "العنوان"],
            ["tax_no", "الرقم الضريبي"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                required={key === "base_name"}
                value={draft[key] || ""}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </Field>
          ))}
          <Field label="ملاحظات">
            <input
              value={draft.notes || ""}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </Field>
          <div className="action-row">
            <button type="submit" className="primary" disabled={busy || !draft.base_name}>
              <Save size={16} /> {editingId ? "حفظ التعديل" : "إضافة المقاول"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraft(empty);
                }}
              >
                إلغاء
              </button>
            )}
          </div>
        </form>
      )}
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>المقاول</th>
              <th>الهاتف</th>
              <th>البريد</th>
              <th>الرقم الضريبي</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.display_name}</td>
                <td dir="ltr">{row.phone || "-"}</td>
                <td dir="ltr">{row.email || "-"}</td>
                <td>{row.tax_no || "-"}</td>
                <td className="row-actions">
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          setEditingId(row.id);
                          setDraft({ ...empty, ...row });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() => setPendingDelete(row)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportWorkspace({
  workflowId,
  locked = false,
  compact = false,
  hideHeading = false,
  api,
  apiBase,
  currentUser,
  refreshKey,
  setMessage,
  onEditRow,
  onDeleteRow,
  onNewRow,
  onOpenDocument,
  onCopyDocument,
  onDocumentConverted,
  context = {},
  setContext = () => {},
}) {
  const [currentWorkflow, setCurrentWorkflow] = useState(
    context.workflowId || workflowId,
  );
  const workflow = WORKFLOWS[currentWorkflow];
  const [partySearch, setPartySearch] = useState(context.partySearch || "");
  const [partySuggestOpen, setPartySuggestOpen] = useState(false);
  const [documentSearch, setDocumentSearch] = useState(
    context.documentSearch || "",
  );
  const [parties, setParties] = useState([]);
  const [documents, setDocuments] = useState(context.documents || []);
  const [partyId, setPartyId] = useState(context.partyId || "");
  const [documentId, setDocumentId] = useState(context.documentId || "");
  const [projectFilter, setProjectFilter] = useState(
    context.projectFilter || "",
  );
  const [projectFilters, setProjectFilters] = useState(
    Array.isArray(context.projectFilters) ? context.projectFilters : [],
  );
  const [workTypeFilter, setWorkTypeFilter] = useState(
    context.workTypeFilter || "",
  );
  const [certificateFilter, setCertificateFilter] = useState(
    context.certificateFilter || "",
  );
  const [reportData, setReportData] = useState(context.reportData || null);
  const [contractorRows, setContractorRows] = useState([]);
  const [documentDraft, setDocumentDraft] = useState({
    status: "draft",
    discount_type: "none",
    discount_value: 0,
  });
  const [dimensionUnit, setDimensionUnit] = useState(
    context.dimensionUnit || "cm",
  );
  const [subtotalMode, setSubtotalMode] = useState(
    encodeSubtotalMode(subtotalFlagsFromMode(context.subtotalMode || "none")),
  );
  const [previewUrl, setPreviewUrl] = useState(context.previewUrl || "");
  const [previewKey, setPreviewKey] = useState(context.previewKey || "");
  const [busy, setBusy] = useState(false);
  const [pendingDocumentDelete, setPendingDocumentDelete] = useState(null);
  const isStatementWorkflow = currentWorkflow === "statement";
  const isContractorWorkflow = currentWorkflow === "contractor";
  const documentSearchId = firstDocumentToken(documentSearch);
  const canRunReport = isStatementWorkflow
    ? !!partyId
    : !!partyId || !!documentId || !!documentSearchId;

  useEffect(() => {
    setCurrentWorkflow(workflowId);
  }, [workflowId]);

  useEffect(() => {
    if (context?.workflowId === currentWorkflow) return;
    setPartyId("");
    setDocumentId("");
    setProjectFilter("");
    setProjectFilters([]);
    setWorkTypeFilter("");
    setCertificateFilter("");
    setDocumentSearch("");
    setDocuments([]);
    setReportData(null);
  }, [currentWorkflow]);

  useEffect(() => {
    if (!context || context.workflowId !== currentWorkflow) return;
    if (context.partySearch !== undefined)
      setPartySearch(context.partySearch || "");
    if (context.documentSearch !== undefined)
      setDocumentSearch(context.documentSearch || "");
    if (context.documents !== undefined) setDocuments(context.documents || []);
    if (context.partyId !== undefined)
      setPartyId(context.partyId ? String(context.partyId) : "");
    if (context.documentId !== undefined)
      setDocumentId(context.documentId ? String(context.documentId) : "");
    if (context.projectFilter !== undefined)
      setProjectFilter(context.projectFilter || "");
    if (context.projectFilters !== undefined)
      setProjectFilters(
        Array.isArray(context.projectFilters) ? context.projectFilters : [],
      );
    if (context.workTypeFilter !== undefined)
      setWorkTypeFilter(context.workTypeFilter || "");
    if (context.certificateFilter !== undefined)
      setCertificateFilter(context.certificateFilter || "");
    if (context.dimensionUnit !== undefined)
      setDimensionUnit(context.dimensionUnit || "cm");
    if (context.subtotalMode !== undefined)
      setSubtotalMode(
        encodeSubtotalMode(subtotalFlagsFromMode(context.subtotalMode || "none")),
      );
    if (Object.prototype.hasOwnProperty.call(context, "reportData"))
      setReportData(context.reportData || null);
    if (Object.prototype.hasOwnProperty.call(context, "previewUrl"))
      setPreviewUrl(context.previewUrl || "");
    if (Object.prototype.hasOwnProperty.call(context, "previewKey"))
      setPreviewKey(context.previewKey || "");
  }, [context, currentWorkflow]);

  useEffect(() => {
    let cancelled = false;
    async function loadParties() {
      const query = new URLSearchParams({ role: workflow.partyRole });
      if (workflow.documentType)
        query.set("document_type", workflow.documentType);
      if (workflow.documentStatus)
        query.set("document_status", workflow.documentStatus);
      if (partySearch) query.set("q", partySearch);
      try {
        const data = await api.request(`/api/parties?${query.toString()}`);
        if (!cancelled) {
          setParties(data);
          const idSearch = String(partySearch || "").trim();
          if (
            idSearch &&
            /^\d+/.test(idSearch) &&
            data.length === 1 &&
            String(data[0].id) !== String(partyId)
          ) {
            setPartyId(String(data[0].id));
            setDocumentId("");
            setContext({ partyId: String(data[0].id), documentId: "" });
          }
        }
      } catch (error) {
        if (!cancelled && !error?.paymentRequired && error?.status !== 402)
          setMessage(`تعذر تحميل القائمة: ${error.message}`);
      }
    }
    loadParties();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    workflow.partyRole,
    workflow.documentType,
    workflow.documentStatus,
    partySearch,
    partyId,
    refreshKey,
    setMessage,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadDocuments() {
      if (!partyId) {
        setDocuments([]);
        return;
      }
      const query = new URLSearchParams({ party_id: partyId });
      if (workflow.documentType) query.set("type", workflow.documentType);
      if (workflow.documentStatus) query.set("status", workflow.documentStatus);
      try {
        const data = await api.request(`/api/documents?${query.toString()}`);
        if (!cancelled) {
          setDocuments(data);
          const searchText = String(documentSearch || partySearch || "").trim();
          const searchId = firstDocumentToken(searchText);
          const matchedBySearch = searchText
            ? data.find((item) =>
                [item.id, item.document_no, item.operation_no].some((value) => {
                  const candidate = String(value || "");
                  return (
                    (searchId && candidate.includes(searchId)) ||
                    (!searchId && candidate.includes(searchText))
                  );
                }),
              )
            : null;
          const nextDocumentId = isStatementWorkflow || isContractorWorkflow
            ? ""
            : matchedBySearch?.id
              ? String(matchedBySearch.id)
              : data.some((item) => String(item.id) === String(documentId))
                ? documentId
                : data[0]?.id
                  ? String(data[0].id)
                  : "";
          if (nextDocumentId !== documentId) setDocumentId(nextDocumentId);
          setContext({ documents: data, documentId: nextDocumentId });
        }
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل المستندات: ${error.message}`);
      }
    }
    loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    partyId,
    workflow.documentType,
    workflow.documentStatus,
    partySearch,
    documentSearch,
    refreshKey,
    setMessage,
    isStatementWorkflow,
    isContractorWorkflow,
  ]);

  const selectedParty = parties.find(
    (item) => String(item.id) === String(partyId),
  );
  const selectedDocument = documents.find(
    (item) =>
      String(item.id) === String(documentId) ||
      (documentSearchId &&
        [item.id, item.document_no, item.operation_no].some((value) =>
          String(value || "").includes(documentSearchId),
        )),
  );
  const rawProjectOptions = [
    ...documents.map((doc) => doc.project),
    ...contractorRows.map((row) => row.project),
  ];
  const hasUnassignedProjects = rawProjectOptions.some(
    (project) => !cleanProjectName(project),
  );
  const projectOptions = uniqueValues(rawProjectOptions.map(cleanProjectName));
  const contractorProjectOptions = [
    ...projectOptions.map((project) => ({ value: project, label: project })),
    ...(hasUnassignedProjects
      ? [{ value: UNASSIGNED_PROJECT, label: "بدون مشروع" }]
      : []),
  ];
  const contractorWorkOptions = uniqueValues([
    ...(reportData?.rows || []).map((row) => row.work_type),
    ...contractorRows.map((row) => row.work_type),
  ]);
  const contractorCertificateOptions = uniqueValues([
    ...(reportData?.rows || []).map((row) => row.certificate_no),
    ...contractorRows.map((row) => row.certificate_no),
  ]);
  const shownParties = parties.slice(0, compact ? 6 : 10);
  const subtotalFlags = subtotalFlagsFromMode(subtotalMode);

  function toggleSubtotalMode(kind) {
    const next = encodeSubtotalMode({
      ...subtotalFlags,
      [kind]: !subtotalFlags[kind],
    });
    setSubtotalMode(next);
    setContext({ subtotalMode: next });
  }

  function chooseParty(party) {
    const nextPartyId = party?.id ? String(party.id) : "";
    const label = party?.display_name || party?.base_name || "";
    setPartySearch(label);
    setPartyId(nextPartyId);
    setDocumentSearch("");
    setDocumentId("");
    setProjectFilter("");
    setProjectFilters([]);
    setReportData(null);
    setPreviewUrl("");
    setPreviewKey("");
    setPartySuggestOpen(false);
    setContext({
      partySearch: label,
      partyId: nextPartyId,
      documentSearch: "",
      documentId: "",
      projectFilter: "",
      projectFilters: [],
      reportData: null,
      previewUrl: "",
      previewKey: "",
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadContractorRows() {
      if (!isContractorWorkflow || !partyId) {
        setContractorRows([]);
        return;
      }
      try {
        const params = new URLSearchParams({ party_id: partyId, limit: "500" });
        const data = await api.request(`/api/entries?${params.toString()}`);
        if (!cancelled) setContractorRows(data.rows || []);
      } catch {
        if (!cancelled) setContractorRows([]);
      }
    }
    loadContractorRows();
    return () => {
      cancelled = true;
    };
  }, [api, isContractorWorkflow, partyId, refreshKey]);

  function applySearchedDocument(doc) {
    if (!doc?.id) return;
    const nextPartyId = doc.party_id ? String(doc.party_id) : "";
    setDocumentSearch(documentOptionText(doc));
    setPartySearch(doc.customer_name || doc.display_name || "");
    setPartyId(nextPartyId);
    setReportData(null);
    setPreviewUrl("");
    setPreviewKey("");
    setDocuments((current) =>
      current.some((item) => String(item.id) === String(doc.id))
        ? current
        : [doc, ...current],
    );
    if (isStatementWorkflow) {
      setDocumentId("");
      setProjectFilter(doc.project || "");
      setContext({
        documentSearch: documentOptionText(doc),
        partySearch: doc.customer_name || doc.display_name || "",
        partyId: nextPartyId,
        documentId: "",
        projectFilter: doc.project || "",
        reportData: null,
        previewUrl: "",
        previewKey: "",
      });
      return;
    }
    setDocumentId(String(doc.id));
    setProjectFilter(doc.project || "");
    setContext({
      documentSearch: documentOptionText(doc),
      partySearch: doc.customer_name || doc.display_name || "",
      partyId: nextPartyId,
      documentId: String(doc.id),
      projectFilter: doc.project || "",
      documents: [
        doc,
        ...documents.filter((item) => String(item.id) !== String(doc.id)),
      ],
      reportData: null,
      previewUrl: "",
      previewKey: "",
    });
  }

  useEffect(() => {
    if (selectedDocument) {
      setDocumentDraft({
        status: selectedDocument.status || workflow.defaultDocumentStatus,
        discount_type: selectedDocument.discount_type || "none",
        discount_value: selectedDocument.discount_value || 0,
        project: selectedDocument.project || "",
        building_unit: selectedDocument.building_unit || "",
      });
    }
  }, [selectedDocument, workflow.defaultDocumentStatus]);

  function reportQuery() {
    const query = new URLSearchParams();
    const resolvedDocumentKey = !isStatementWorkflow
      ? selectedDocument?.id || documentId || documentSearchId
      : "";
    if (partySearch && (isStatementWorkflow || !resolvedDocumentKey))
      query.set("customer", partySearch);
    if (isStatementWorkflow) {
      if (partyId) query.set("party_id", partyId);
      if (projectFilter) query.set("project", projectFilter);
    } else {
      if (resolvedDocumentKey) query.set("document_id", resolvedDocumentKey);
      else if (partyId) query.set("party_id", partyId);
    }
    if (isContractorWorkflow) {
      if (projectFilters.length)
        query.set("projects", JSON.stringify(projectFilters));
      if (workTypeFilter) query.set("work_type", workTypeFilter);
      if (certificateFilter) query.set("certificate_no", certificateFilter);
    }
    query.set("dimension_unit", dimensionUnit);
    query.set("subtotal_mode", subtotalMode);
    if (currentUser?.display_name)
      query.set("user_name", currentUser.display_name);
    return query;
  }

  function reportQueryObject() {
    return Object.fromEntries(reportQuery().entries());
  }

  function queryForResolvedDocument(resolvedDocumentId = "") {
    const query = reportQuery();
    if (!isStatementWorkflow && resolvedDocumentId) {
      query.set("document_id", String(resolvedDocumentId));
    }
    return query;
  }

  function currentPreviewKey(resolvedDocumentId = "") {
    return `${workflow.reportType}?${queryForResolvedDocument(resolvedDocumentId).toString()}`;
  }

  async function showExportPreview() {
    if (!canRunReport) return;
    setBusy(true);
    try {
      const { data, resolvedDocumentId } = await requestReportWithFallback();
      if (resolvedDocumentId && String(resolvedDocumentId) !== String(documentId))
        setDocumentId(String(resolvedDocumentId));
      const query = queryForResolvedDocument(resolvedDocumentId);
      const key = `${workflow.reportType}?${query.toString()}`;
      const url = buildUrl(
        apiBase,
        `/api/documents/${workflow.reportType}/html?${query.toString()}`,
      );
      const resolvedDocument =
        selectedDocument ||
        (resolvedDocumentId
          ? {
              id: resolvedDocumentId,
              document_type: workflow.documentType,
              status: workflow.documentStatus || data.status || "",
              operation_no: data.operation_no || documentSearchId || "",
              document_no: data.document_no || data.serial || "",
              project: data.project || projectFilters[0] || projectFilter || "",
              building_unit: data.building_unit || "",
              party_id: data.party_id || partyId || "",
              customer_name: data.party || partySearch || "",
            }
          : null);
      setReportData(null);
      setPreviewUrl(url);
      setPreviewKey(key);
      setContext({
        workflowId: currentWorkflow,
        partySearch,
        documentSearch,
        partyId,
        documentId: resolvedDocumentId || documentId,
        projectFilter,
        projectFilters,
        workTypeFilter,
        certificateFilter,
        documents: resolvedDocument
          ? [
              resolvedDocument,
              ...documents.filter(
                (item) => String(item.id) !== String(resolvedDocument.id),
              ),
            ]
          : documents,
        reportData: null,
        previewUrl: url,
        previewKey: key,
        dimensionUnit,
        subtotalMode,
        party: selectedParty,
        document: resolvedDocument,
      });
      setMessage(
        "تم تجهيز معاينة التقرير. راجعها ثم اضغط PDF أو Excel XLSX للحفظ.",
      );
    } catch (error) {
      setMessage(`تعذر تجهيز المعاينة: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function requestReportWithFallback() {
    const baseQuery = reportQuery();
    const data = await api.request(
      `/api/documents/${workflow.reportType}?${baseQuery.toString()}`,
    );
    if (isStatementWorkflow || reportHasContent(data))
      return {
        data,
        resolvedDocumentId:
          data.document_id || data.id || documentSearchId || documentId,
      };

    const candidates = [
      documentId,
      documentSearchId,
      selectedDocument?.id,
      selectedDocument?.operation_no,
      selectedDocument?.document_no,
      ...(String(documentSearch || "").match(/\d+/g) || []),
    ]
      .filter(Boolean)
      .map(String);
    for (const candidate of [...new Set(candidates)]) {
      const query = reportQuery();
      query.set("document_id", candidate);
      const retry = await api.request(
        `/api/documents/${workflow.reportType}?${query.toString()}`,
      );
      if (reportHasContent(retry)) {
        return {
          data: retry,
          resolvedDocumentId: retry.document_id || retry.id || candidate,
        };
      }
    }
    return { data, resolvedDocumentId: documentSearchId || documentId };
  }

  async function loadReport() {
    if (!canRunReport) return;
    setBusy(true);
    try {
      const { data, resolvedDocumentId } = await requestReportWithFallback();
      if (resolvedDocumentId && String(resolvedDocumentId) !== String(documentId))
        setDocumentId(String(resolvedDocumentId));
      const resolvedDocument =
        selectedDocument ||
        (resolvedDocumentId
          ? {
              id: resolvedDocumentId,
              document_type: workflow.documentType,
              status: workflow.documentStatus || data.status || "",
              operation_no: data.operation_no || documentSearchId || "",
              document_no: data.document_no || data.serial || "",
              project: data.project || projectFilters[0] || projectFilter || "",
              building_unit: data.building_unit || "",
              party_id: data.party_id || partyId || "",
              customer_name: data.party || partySearch || "",
            }
          : null);
      setReportData(data);
      setPreviewUrl("");
      setPreviewKey("");
      setContext({
        workflowId: currentWorkflow,
        partySearch,
        documentSearch,
        partyId,
        documentId: resolvedDocumentId || documentId,
        projectFilter,
        projectFilters,
        workTypeFilter,
        certificateFilter,
        documents: resolvedDocument
          ? [
              resolvedDocument,
              ...documents.filter(
                (item) => String(item.id) !== String(resolvedDocument.id),
              ),
            ]
          : documents,
        reportData: data,
        previewUrl: "",
        previewKey: "",
        dimensionUnit,
        subtotalMode,
        party: selectedParty,
        document: resolvedDocument,
      });
    } catch (error) {
      setMessage(`تعذر تجهيز التقرير: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument() {
    if (!selectedDocument) return;
    if (
      String(documentDraft.status || "") !==
        String(selectedDocument.status || "") &&
      !canUser(currentUser, "can_change_status")
    ) {
      setMessage("هذا المستخدم غير مسموح له بتغيير حالة المستند.");
      return;
    }
    setBusy(true);
    try {
      const updatedDocument = await api.request(`/api/documents/${selectedDocument.id}`, {
        method: "PUT",
        body: JSON.stringify(documentDraft),
      });
      if (
        selectedDocument.document_type === "price_offer" &&
        updatedDocument.document_type === "invoice"
      ) {
        setMessage("تم اعتماد عرض السعر وتحويله مباشرة إلى فاتورة.");
        onDocumentConverted?.({
          ...updatedDocument,
          base_party_name: selectedParty?.base_name,
          display_name: selectedParty?.display_name,
          category: selectedParty?.category,
        });
        return;
      }
      setDocuments((current) =>
        current.map((item) =>
          String(item.id) === String(updatedDocument.id) ? updatedDocument : item,
        ),
      );
      setMessage("تم حفظ بيانات المستند.");
      await loadReport();
    } catch (error) {
      setMessage(`لم يتم حفظ بيانات المستند: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedDocument(document = selectedDocument) {
    if (!document?.id) return;
    setBusy(true);
    try {
      await api.request(`/api/documents/${document.id}`, {
        method: "DELETE",
        body: JSON.stringify({ requester_user_id: currentUser?.id }),
      });
      setDocuments((current) =>
        current.filter((item) => String(item.id) !== String(document.id)),
      );
      setDocumentId("");
      setDocumentSearch("");
      setReportData(null);
      setPreviewUrl("");
      setPreviewKey("");
      setContext({
        documentId: "",
        documentSearch: "",
        reportData: null,
        previewUrl: "",
        previewKey: "",
      });
      setMessage(
        `تم حذف المستند ${document.operation_no || document.document_no || document.id} وكل البنود المرتبطة به نهائياً.`,
        { type: "success", sticky: true },
      );
    } catch (error) {
      setMessage(`تعذر حذف المستند: ${error.message}`, { type: "error" });
    } finally {
      setBusy(false);
      restoreInputInteractivity();
    }
  }

  async function exportReport(kind, options = {}) {
    if (!canRunReport) return;
    setBusy(true);
    try {
      const extension = kind === "pdf" ? "pdf" : "xlsx";
      const { resolvedDocumentId } = await requestReportWithFallback();
      if (resolvedDocumentId && String(resolvedDocumentId) !== String(documentId))
        setDocumentId(String(resolvedDocumentId));
      const exportQuery = queryForResolvedDocument(resolvedDocumentId);
      const response = await fetch(
        buildUrl(
          apiBase,
          `/api/documents/${workflow.reportType}/${extension}?${exportQuery.toString()}`,
        ),
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || response.statusText || "Export failed");
      }
      const blob = await response.blob();
      const fileName = fileNameFromDisposition(
        response.headers.get("Content-Disposition"),
        `${workflow.label}.${extension}`,
      );
      if (window.priceOfferDesktop?.saveReportFile) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const saved = await window.priceOfferDesktop.saveReportFile({
          bytes,
          fileName,
          format: extension,
          reportType: currentWorkflow || workflow.reportType,
        });
        if (saved?.canceled) {
          setMessage("تم إلغاء حفظ التقرير.", { type: "warning" });
          return;
        }
        if (!saved?.savedPath) throw new Error("The desktop app returned no saved file path.");
        setMessage(
          `تم حفظ ${kind === "pdf" ? "PDF" : "Excel XLSX"} بنجاح: ${saved.savedPath}`,
          { type: "success", sticky: true },
        );
        return;
      }
      if (await isNativeApp()) {
        if (options.share && extension === "pdf") {
          await shareNativeReport(blob, fileName);
          setMessage(`تم فتح نافذة مشاركة PDF: ${fileName}`);
          return;
        }
        await saveNativeReport(blob, fileName);
        setMessage(
          `تم حفظ الملف على هذا الجهاز داخل مجلد Price offers: ${fileName}`,
        );
        return;
      }
      if (options.share && extension === "pdf") {
        const file = new File([blob], fileName, { type: "application/pdf" });
        if (
          navigator.share &&
          (!navigator.canShare || navigator.canShare({ files: [file] }))
        ) {
          await navigator.share({ files: [file], title: fileName });
          setMessage(`تم فتح نافذة مشاركة PDF: ${fileName}`);
          return;
        }
        downloadBlob(blob, fileName);
        setMessage(
          `المشاركة غير مدعومة هنا، تم تنزيل PDF على هذا الجهاز: ${fileName}`,
        );
        return;
      }
      downloadBlob(blob, fileName);
      setMessage(
        `تم تنزيل ${kind === "pdf" ? "PDF" : "Excel XLSX"} على هذا الجهاز: ${fileName}`,
      );
    } catch (error) {
      setMessage(`تعذر تصدير الملف: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={
        compact
          ? "panel report-workspace compact-workflow"
          : "panel report-workspace"
      }
    >
      <ConfirmationLayer
        dialog={
          pendingDocumentDelete
            ? {
                title: "حذف المستند نهائياً",
                message: `تحذير: سيتم حذف المستند ${pendingDocumentDelete.operation_no || pendingDocumentDelete.document_no || pendingDocumentDelete.id} وكل البنود المرتبطة به. لا يمكن التراجع عن هذا الإجراء.`,
                confirmLabel: "حذف نهائي",
                danger: true,
              }
            : null
        }
        onResult={(confirmed) => {
          const document = pendingDocumentDelete;
          setPendingDocumentDelete(null);
          if (confirmed) deleteSelectedDocument(document);
          else restoreInputInteractivity();
        }}
      />
      {busy && <LoadingOverlay compact />}
      {(!hideHeading || !locked) && (
        <div className="panel-head">
          <h2>{workflow.label}</h2>
          {!locked && (
            <select
              value={currentWorkflow}
              aria-label="نوع المستند"
              title="فلترة حسب نوع المستند"
              onChange={(event) => {
                setCurrentWorkflow(event.target.value);
                setContext({ workflowId: event.target.value });
              }}
            >
              {Object.entries(WORKFLOWS)
                .filter(([id]) => !compact || ["offer", "invoice", "contractor"].includes(id))
                .map(([id, item]) => (
                <option key={id} value={id}>
                  {item.label}
                </option>
                ))}
            </select>
          )}
        </div>
        )}

      <div className="chain-grid">
        <DocumentIdSearch
          api={api}
          type={isStatementWorkflow ? "" : workflow.documentType}
          status={workflow.documentStatus || ""}
          value={documentSearch}
          onChange={(value) => {
            setDocumentSearch(value);
            setPartySearch("");
            setPartyId("");
            setDocuments([]);
            setDocumentId("");
            setProjectFilter("");
            setProjectFilters([]);
            setWorkTypeFilter("");
            setCertificateFilter("");
            setReportData(null);
            setPreviewUrl("");
            setPreviewKey("");
            setContext({
              documentSearch: value,
              partySearch: "",
              partyId: "",
              documents: [],
              documentId: "",
              projectFilter: "",
              projectFilters: [],
              workTypeFilter: "",
              certificateFilter: "",
              reportData: null,
              previewUrl: "",
              previewKey: "",
            });
          }}
          onSelect={applySearchedDocument}
          title="اكتب رقم المستند أو ID للانتقال إليه مباشرة داخل هذا القسم"
        />
        <Field label={`${workflow.partyLabel} - بحث`}>
          <div className="inline-field party-search-field">
            <Search size={16} />
            <input
              value={partySearch}
              onFocus={() => setPartySuggestOpen(true)}
              onBlur={() => window.setTimeout(() => setPartySuggestOpen(false), 250)}
              onChange={(event) => {
                setPartySuggestOpen(true);
                setPartySearch(event.target.value);
                setDocumentSearch("");
                setPartyId("");
                setDocuments([]);
                setDocumentId("");
                setProjectFilter("");
                setProjectFilters([]);
                setWorkTypeFilter("");
                setCertificateFilter("");
                setReportData(null);
                setPreviewUrl("");
                setPreviewKey("");
                setContext({
                  partySearch: event.target.value,
                  documentSearch: "",
                  partyId: "",
                  documents: [],
                  documentId: "",
                  projectFilter: "",
                  projectFilters: [],
                  workTypeFilter: "",
                  certificateFilter: "",
                  reportData: null,
                  previewUrl: "",
                  previewKey: "",
                });
              }}
              placeholder={workflow.partyLabel}
              autoComplete="off"
            />
            {partySuggestOpen && shownParties.length > 0 && (
              <div className="inline-suggestions compact-party-suggestions">
                {shownParties.map((party) => (
                  <button
                    key={party.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      chooseParty(party);
                    }}
                  >
                    <strong>{party.display_name}</strong>
                    <small>ID {party.id}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label={workflow.partyLabel}>
          <select
            value={partyId}
            onChange={(event) => {
              const party = parties.find(
                (item) => String(item.id) === event.target.value,
              );
              if (party) {
                chooseParty(party);
                return;
              }
              setPartyId(event.target.value);
              setDocumentSearch("");
              setDocumentId("");
              setProjectFilter("");
              setProjectFilters([]);
              setReportData(null);
              setPreviewUrl("");
              setPreviewKey("");
              setContext({
                partyId: event.target.value,
                documentSearch: "",
                documentId: "",
                projectFilter: "",
                projectFilters: [],
                reportData: null,
                previewUrl: "",
                previewKey: "",
              });
            }}
          >
            <option value="">--</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.display_name}
              </option>
            ))}
          </select>
        </Field>
        {isStatementWorkflow ? (
          <ComboField
            label="المشروع (اختياري)"
            value={projectFilter}
            options={projectOptions}
            onChange={(value) => {
              setProjectFilter(value);
              setDocumentId("");
              setReportData(null);
              setPreviewUrl("");
              setPreviewKey("");
              setContext({
                projectFilter: value,
                documentId: "",
                reportData: null,
                previewUrl: "",
                previewKey: "",
              });
            }}
          />
        ) : (
          <Field label="رقم / مستند">
            <select
              value={documentId}
              onChange={(event) => {
                setDocumentId(event.target.value);
                setReportData(null);
                setPreviewUrl("");
                setPreviewKey("");
                setContext({
                  documentId: event.target.value,
                  reportData: null,
                  previewUrl: "",
                  previewKey: "",
                });
              }}
            >
              <option value="">كل مستندات المحدد</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.operation_no} -{" "}
                  {doc.project ||
                    doc.title ||
                    documentTypeLabel(doc.document_type)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isContractorWorkflow && (
          <>
            <MultiComboField
              label="المشروعات (اختياري)"
              values={projectFilters}
              options={contractorProjectOptions}
              onChange={(values) => {
                setProjectFilters(values);
                setDocumentId("");
                setReportData(null);
                setPreviewUrl("");
                setPreviewKey("");
                setContext({
                  projectFilters: values,
                  documentId: "",
                  reportData: null,
                  previewUrl: "",
                  previewKey: "",
                });
              }}
            />
            <ComboField
              label="نوع الأعمال (اختياري)"
              value={workTypeFilter}
              options={contractorWorkOptions}
              onChange={(value) => {
                setWorkTypeFilter(value);
                setDocumentId("");
                setReportData(null);
                setPreviewUrl("");
                setPreviewKey("");
                setContext({
                  workTypeFilter: value,
                  documentId: "",
                  reportData: null,
                  previewUrl: "",
                  previewKey: "",
                });
              }}
            />
            <ComboField
              label="رقم المستخلص (اختياري)"
              value={certificateFilter}
              options={contractorCertificateOptions}
              onChange={(value) => {
                setCertificateFilter(value);
                setDocumentId("");
                setReportData(null);
                setPreviewUrl("");
                setPreviewKey("");
                setContext({
                  certificateFilter: value,
                  documentId: "",
                  reportData: null,
                  previewUrl: "",
                  previewKey: "",
                });
              }}
            />
          </>
        )}
        <div className="action-row">
          {(currentWorkflow === "offer" || currentWorkflow === "invoice") && (
            <button
              type="button"
              className="tiny-toggle"
              title="تبديل ظهور المقاسات بين سنتيمتر ومتر"
              onClick={() => {
                const next = dimensionUnit === "cm" ? "m" : "cm";
                setDimensionUnit(next);
                setContext({ dimensionUnit: next });
              }}
            >
              المقاس: {dimensionUnit === "cm" ? "سم" : "م"}
            </button>
          )}
          {(currentWorkflow === "offer" ||
            currentWorkflow === "invoice" ||
            currentWorkflow === "contractor") && (
            <>
              <button
                type="button"
                title="إظهار أو إخفاء إجمالي كل مبنى"
                className={subtotalFlags.building ? "tiny-toggle active" : "tiny-toggle"}
                onClick={() => toggleSubtotalMode("building")}
              >
                إجمالي مباني
              </button>
              <button
                type="button"
                title="إظهار أو إخفاء إجمالي كل وحدة"
                className={subtotalFlags.unit ? "tiny-toggle active" : "tiny-toggle"}
                onClick={() => toggleSubtotalMode("unit")}
              >
                إجمالي وحدات
              </button>
            </>
          )}
          {currentWorkflow !== "statement" && (
            <>
              <button
                title="نسخ المستند المحدد إلى ID جديد دون تغيير الأصل"
                onClick={() =>
                  onCopyDocument?.(selectedDocument, selectedParty, reportData)
                }
                disabled={!selectedDocument || !onCopyDocument}
              >
                <Copy size={18} /> نسخ إلى مستند جديد
              </button>
              <button
                title="تعديل المستند المحدد في صفحة الإدخال الذكية"
                onClick={() => {
                  if (!selectedDocument) return;
                  if (onOpenDocument) {
                    onOpenDocument(selectedDocument, selectedParty);
                    return;
                  }
                  onEditRow(
                    {
                      document_id: selectedDocument.id,
                      document_type: selectedDocument.document_type,
                      document_status: selectedDocument.status,
                      operation_no: selectedDocument.operation_no,
                      serial: selectedDocument.document_no,
                      project: selectedDocument.project,
                      building_unit: selectedDocument.building_unit,
                      party_id: selectedDocument.party_id,
                      customer_name: selectedDocument.customer_name,
                    },
                    {
                      workflowId: currentWorkflow,
                      party: selectedParty,
                      document: selectedDocument,
                      reportData,
                    },
                  );
                }}
                disabled={!selectedDocument}
              >
                <Pencil size={18} /> تعديل
              </button>
              <button
                type="button"
                className="danger"
                title="حذف المستند المحدد نهائياً"
                onClick={() => setPendingDocumentDelete(selectedDocument)}
                disabled={
                  !selectedDocument ||
                  !canUser(currentUser, "can_change_status")
                }
              >
                <Trash2 size={18} /> حذف المستند
              </button>
            </>
          )}
          <button
            className="primary"
            title="عرض التقرير المحدد داخل التطبيق"
            onClick={loadReport}
            disabled={busy || !canRunReport}
          >
            <Search size={18} /> عرض
          </button>
          <button
            title="فتح معاينة التقرير قبل التصدير"
            onClick={showExportPreview}
            disabled={!canRunReport}
          >
            <Eye size={18} /> معاينة PDF
          </button>
          <button
            title="تنزيل PDF على هذا الجهاز"
            onClick={() => exportReport("pdf")}
            disabled={!canRunReport}
          >
            <FileDown size={18} /> PDF
          </button>
          <button
            title="تصدير PDF ثم فتح نافذة المشاركة"
            onClick={() => exportReport("pdf", { share: true })}
            disabled={!canRunReport}
          >
            <Share2 size={18} /> مشاركة
          </button>
          <button
            title="تنزيل ملف Excel XLSX منسق"
            onClick={() => exportReport("xlsx")}
            disabled={!canRunReport}
          >
            <FileSpreadsheet size={18} /> Excel XLSX
          </button>
        </div>
      </div>

      {selectedDocument && currentWorkflow !== "statement" && (
        <div className="document-strip">
          <Field label="الحالة">
            <select
              value={documentDraft.status}
              disabled={!canUser(currentUser, "can_change_status")}
              onChange={(event) =>
                setDocumentDraft({
                  ...documentDraft,
                  status: event.target.value,
                })
              }
            >
              <option value="draft">مسودة</option>
              <option value="approved">معتمد</option>
              <option value="closed">مغلق</option>
            </select>
          </Field>
          <Field label="نوع الخصم">
            <select
              value={documentDraft.discount_type}
              onChange={(event) =>
                setDocumentDraft({
                  ...documentDraft,
                  discount_type: event.target.value,
                })
              }
            >
              <option value="none">بدون</option>
              <option value="rate">نسبة</option>
              <option value="amount">مبلغ</option>
            </select>
          </Field>
          <Field label="قيمة الخصم">
            <input
              type="text"
              inputMode="decimal"
              value={documentDraft.discount_value}
              onChange={(event) =>
                setDocumentDraft({
                  ...documentDraft,
                  discount_value: event.target.value,
                })
              }
            />
          </Field>
          <button onClick={saveDocument} disabled={busy}>
            <Save size={18} /> حفظ المستند
          </button>
        </div>
      )}

      <DocumentPreview
        data={reportData}
        dimensionUnit={dimensionUnit}
        onEditRow={(row) =>
          onEditRow(row, {
            workflowId: currentWorkflow,
            party: selectedParty,
            document: selectedDocument,
            reportData,
          })
        }
        onDeleteRow={onDeleteRow}
        onClose={() => {
          setReportData(null);
          setContext({ reportData: null });
        }}
        compact={compact}
      />
      {previewUrl && (
        <section className="export-preview">
          <div className="panel-head">
            <h2>معاينة التصدير</h2>
            <button
              type="button"
              onClick={() => {
                setPreviewUrl("");
                setPreviewKey("");
                setContext({ previewUrl: "", previewKey: "" });
              }}
            >
              إغلاق المعاينة
            </button>
          </div>
          <div className="preview-frame-wrap">
            <iframe title="Export preview" src={previewUrl} />
          </div>
        </section>
      )}
    </section>
  );
}

function ProductiveQuantitiesView({ api, apiBase, lookups = {}, setMessage }) {
  const now = new Date();
  const [period, setPeriod] = useState("month");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [workTypes, setWorkTypes] = useState([]);
  const [periodWorkTypes, setPeriodWorkTypes] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const months = [
    ["01", "يناير"],
    ["02", "فبراير"],
    ["03", "مارس"],
    ["04", "أبريل"],
    ["05", "مايو"],
    ["06", "يونيو"],
    ["07", "يوليو"],
    ["08", "أغسطس"],
    ["09", "سبتمبر"],
    ["10", "أكتوبر"],
    ["11", "نوفمبر"],
    ["12", "ديسمبر"],
  ];
  const unitGroups = rows.reduce((groups, row) => {
    const key = row.unit_label || row.unit || "عام";
    groups[key] = (groups[key] || 0) + Number(row.quantity || 0);
    return groups;
  }, {});
  const workTypeOptions = uniqueValues(periodWorkTypes)
    .filter(Boolean)
    .map((value) => ({ value, label: value }));

  const loadPeriodWorkTypes = useCallback(async () => {
    try {
      const query = new URLSearchParams({ period, year });
      if (period === "month") query.set("month", month);
      const data = await api.request(
        `/api/productive-quantities?${query.toString()}`,
      );
      const available = uniqueValues(
        (data.rows || []).map((row) => row.work_type),
      ).filter(Boolean);
      setPeriodWorkTypes(available);
      setWorkTypes((current) =>
        current.filter((workType) => available.includes(workType)),
      );
    } catch (error) {
      setPeriodWorkTypes([]);
      setWorkTypes([]);
      setMessage?.(`تعذر تحميل أنواع الأعمال لهذه الفترة: ${error.message}`);
    }
  }, [api, month, period, setMessage, year]);

  const reportQuery = useCallback(() => {
    const query = new URLSearchParams({ period, year });
    if (period === "month") query.set("month", month);
    workTypes.forEach((workType) => {
      if (workType) query.append("work_type", workType);
    });
    return query;
  }, [month, period, workTypes, year]);

  const loadRows = useCallback(async () => {
    setBusy(true);
    try {
      const query = reportQuery();
      const data = await api.request(`/api/productive-quantities?${query.toString()}`);
      setRows(data.rows || []);
    } catch (error) {
      setRows([]);
      setMessage?.(`تعذر تحميل تقرير الكميات المنتجة: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }, [api, reportQuery, setMessage]);

  const exportReport = async (format) => {
    setBusy(true);
    try {
      const query = reportQuery();
      const extension = format === "pdf" ? "pdf" : "xlsx";
      const response = await fetch(
        buildUrl(apiBase, `/api/productive-quantities/${extension}?${query.toString()}`),
      );
      if (!response.ok) {
        let message = `Export failed (${response.status})`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch {
          // Ignore non-JSON export errors.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const fallback = `productive-quantities.${extension}`;
      const fileName = fileNameFromDisposition(
        response.headers.get("Content-Disposition"),
        fallback,
      );
      if (window.priceOfferDesktop?.saveReportFile) {
        const saved = await window.priceOfferDesktop.saveReportFile({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          fileName,
          format: extension,
          reportType: "productive-quantities",
        });
        if (saved?.canceled) {
          setMessage?.("تم إلغاء حفظ تقرير الكميات المنتجة.");
          return;
        }
        setMessage?.(`تم حفظ تقرير الكميات المنتجة: ${saved.savedPath}`, {
          type: "success",
          sticky: true,
        });
        return;
      }
      downloadBlob(blob, fileName);
      setMessage?.(`تم تنزيل تقرير الكميات المنتجة: ${fileName}`);
    } catch (error) {
      setMessage?.(`تعذر تصدير تقرير الكميات المنتجة: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  function openPreview() {
    const query = reportQuery();
    setPreviewUrl(
      buildUrl(apiBase, `/api/productive-quantities/html?${query.toString()}`),
    );
    setMessage?.("Productive quantities preview opened.");
  }

  useEffect(() => {
    loadPeriodWorkTypes();
  }, [loadPeriodWorkTypes]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  return (
    <div className="page-stack">
      <section className="panel productive-quantities">
        {busy && <LoadingOverlay compact />}
        <div className="panel-head">
          <h2>
            <FileSpreadsheet size={18} /> الكميات المنتجة
          </h2>
          <span className="user-chip">{rows.length} بند</span>
        </div>
        <div className="productive-filter-row">
          <div className="segmented">
            <button
              type="button"
              className={period === "month" ? "active" : ""}
              onClick={() => setPeriod("month")}
            >
              شهري
            </button>
            <button
              type="button"
              className={period === "year" ? "active" : ""}
              onClick={() => setPeriod("year")}
            >
              سنوي
            </button>
          </div>
          <Field label="السنة">
            <input
              type="text"
              inputMode="numeric"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </Field>
          {period === "month" && (
            <Field label="الشهر">
              <select
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              >
                {months.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <MultiComboField
            label="نوع الأعمال"
            values={workTypes}
            options={workTypeOptions}
            allLabel={
              periodWorkTypes.length
                ? "كل أنواع الأعمال في الفترة"
                : "لا توجد أنواع أعمال في الفترة"
            }
            multipleLabel="أنواع أعمال محددة"
            clearLabel="عرض كل الأنواع"
            onChange={setWorkTypes}
          />
          <button type="button" className="primary" onClick={loadRows} disabled={busy}>
            <Search size={18} /> تحديث
          </button>
          <button type="button" onClick={openPreview} disabled={busy}>
            <Eye size={18} /> Preview
          </button>
          <button type="button" onClick={() => exportReport("pdf")} disabled={busy}>
            <FileDown size={18} /> PDF
          </button>
          <button type="button" onClick={() => exportReport("xlsx")} disabled={busy}>
            <FileSpreadsheet size={18} /> Excel XLSX
          </button>
        </div>
        {!!rows.length && (
          <div className="quantity-summary-row">
            {Object.entries(unitGroups).map(([unit, total]) => (
              <span key={unit}>
                {unit}: <strong>{money(total)}</strong>
              </span>
            ))}
          </div>
        )}
        <div className="table-scroll compact-table productive-table">
          <table>
            <thead>
              <tr>
                <th>المصدر</th>
                <th>التاريخ</th>
                <th>العميل</th>
                <th>المقاول</th>
                <th>المشروع</th>
                <th>نوع الأعمال</th>
                <th>الكمية</th>
                <th>وحدة الكمية</th>
                <th>نسبة العمل</th>
                <th>المستند</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.source_type}-${row.id}`}>
                  <td>{row.source_label}</td>
                  <td dir="ltr">{dateInputValue(row.entry_date)}</td>
                  <td>{text(row.customer)}</td>
                  <td>{text(row.contractor)}</td>
                  <td>{text(cleanProjectName(row.project))}</td>
                  <td>{text(row.work_type)}</td>
                  <td>{money(row.quantity)}</td>
                  <td>{text(row.unit_label)}</td>
                  <td>{row.work_ratio ? `${money(row.work_ratio)}%` : "100%"}</td>
                  <td>{text(row.operation_no || row.document_no)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan="10">لا توجد كميات منتجة في هذا الاختيار</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {previewUrl && (
          <section className="export-preview">
            <div className="panel-head">
              <h2>Preview</h2>
              <button type="button" onClick={() => setPreviewUrl("")}>
                <X size={17} /> Close preview
              </button>
            </div>
            <div className="preview-frame-wrap">
              <iframe title="Productive quantities preview" src={previewUrl} />
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function PaymentsView({
  api,
  lookups,
  currentUser,
  refreshKey,
  setMessage,
  refreshAll,
  focus,
  partyRole = "customer",
}) {
  const isContractorMode = partyRole === "contractor";
  const [form, setForm] = useState({
    payment_type: isContractorMode ? "out" : "income",
    party_category: "retail",
    base_party_name: "",
    project: "",
    building_unit: "",
    work_type: "",
    amount: "",
    entry_date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [recent, setRecent] = useState([]);
  const [paymentCustomers, setPaymentCustomers] = useState([]);
  const [reviewCustomer, setReviewCustomer] = useState("");
  const [related, setRelated] = useState({ projects: [], buildings: [] });
  const [editingPayment, setEditingPayment] = useState(null);
  const [appliedFocusKey, setAppliedFocusKey] = useState("");
  const [busy, setBusy] = useState(false);
  const partyOptions = isContractorMode ? lookups.contractors : lookups.customers;
  const customerNames = uniqueValues(
    (partyOptions || [])
      .filter(
        (party) =>
          form.party_category === "unselected" ||
          !form.party_category ||
          party.category === form.party_category,
      )
      .map((party) => party.base_name || party.display_name),
  );
  const paymentCustomerNames = uniqueValues(
    paymentCustomers.map((row) => row.base_name || row.display_name),
  );
  const selectedCustomerKey = normalizeArabic(form.base_party_name);
  const selectedReviewCustomerKey = normalizeArabic(reviewCustomer);
  const paymentRowName = (row) =>
    String(
      row.base_party_name ||
        row.customer_name ||
        row.customer_display_name ||
        row.party_display_name ||
        "",
    );
  const relatedRecent = recent.filter((row) => {
    const typed = selectedCustomerKey;
    const rowName = normalizeArabic(paymentRowName(row));
    return typed && rowName.includes(typed);
  });
  const projectOptions = uniqueValues([
    ...(related.projects || []),
    ...relatedRecent.map((row) => row.project),
  ]);
  const buildingOptions = uniqueValues([
    ...(related.buildings || []),
    ...relatedRecent
      .filter((row) => !form.project || row.project === form.project)
      .map((row) => row.building_unit),
  ]);
  const paymentWorkTypeOptions = uniqueValues([
    ...lookupValues(lookups.workTypes || []),
    ...relatedRecent.map((row) => row.work_type),
    ...recent.map((row) => row.work_type),
  ]);
  const reviewPayments = selectedReviewCustomerKey
    ? recent.filter((row) =>
        normalizeArabic(paymentRowName(row)).includes(
          selectedReviewCustomerKey,
        ),
      )
    : recent;
  const visiblePayments = reviewPayments
    .filter((row) => !form.project || row.project === form.project)
    .filter(
      (row) => !form.building_unit || row.building_unit === form.building_unit,
    );

  useEffect(() => {
    if (!focus) return;
    const key = [
      focus.party?.id ||
        focus.party?.base_name ||
        focus.party?.display_name ||
        "",
      focus.project || "",
      focus.building_unit || "",
      focus.paymentDocumentId || "",
    ].join("|");
    if (!key || key === appliedFocusKey) return;
    setAppliedFocusKey(key);
    const partyName = focus.party?.base_name || focus.party?.display_name || "";
    setEditingPayment(null);
    setReviewCustomer(partyName);
    setForm((current) => ({
      ...current,
      party_category:
        focus.party?.category || current.party_category || "unselected",
      base_party_name: partyName,
      project: focus.project || "",
      building_unit: focus.building_unit || "",
    }));
  }, [focus, appliedFocusKey]);

  useEffect(() => {
    if (!focus?.paymentDocumentId || !recent.length) return;
    const matched = recent.find(
      (row) => String(row.document_id) === String(focus.paymentDocumentId),
    );
    if (matched && editingPayment?.id !== matched.id) editPayment(matched);
  }, [focus, recent, editingPayment?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadPayments() {
      try {
        const data = await api.request("/api/payments?limit=2000");
        if (!cancelled)
          setRecent(
            (data.rows || []).filter((row) =>
              isContractorMode
                ? row.party_role === "contractor"
                : row.party_role !== "contractor",
            ),
          );
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل الدفعات: ${error.message}`);
      }
    }
    loadPayments();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, setMessage, isContractorMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadPaymentCustomers() {
      try {
        const rows = await api.request(
          `/api/payment-customers?role=${isContractorMode ? "contractor" : "customer"}`,
        );
        if (!cancelled) setPaymentCustomers(rows || []);
      } catch (error) {
        if (!cancelled)
          setMessage(`تعذر تحميل عملاء الدفعات: ${error.message}`);
      }
    }
    loadPaymentCustomers();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, setMessage, isContractorMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadRelated() {
      const name = form.base_party_name.trim();
      if (!name) {
        setRelated({ projects: [], buildings: [] });
        return;
      }
      const query = new URLSearchParams({
        role: isContractorMode ? "contractor" : "customer",
        name,
      });
      if (form.party_category && form.party_category !== "unselected")
        query.set("category", form.party_category);
      if (form.project) query.set("project", form.project);
      try {
        const data = await api.request(
          `/api/party-related?${query.toString()}`,
        );
        if (!cancelled)
          setRelated({
            projects: data.projects || [],
            buildings: data.buildings || [],
          });
      } catch {
        if (!cancelled) setRelated({ projects: [], buildings: [] });
      }
    }
    loadRelated();
    return () => {
      cancelled = true;
    };
  }, [api, form.base_party_name, form.party_category, form.project, isContractorMode]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateCustomer(value) {
    setEditingPayment(null);
    setForm((current) => ({
      ...current,
      base_party_name: value,
      project: "",
      building_unit: "",
    }));
  }

  function resetPaymentForm({ keepCustomer = true } = {}) {
    setEditingPayment(null);
    setForm((current) => ({
      payment_type: isContractorMode ? "out" : "income",
      party_category: keepCustomer ? current.party_category : "retail",
      base_party_name: keepCustomer ? current.base_party_name : "",
      project: keepCustomer ? current.project : "",
      building_unit: keepCustomer ? current.building_unit : "",
      work_type: "",
      amount: "",
      entry_date: new Date().toISOString().slice(0, 10),
      note: "",
    }));
  }

  function editPayment(row) {
    setEditingPayment(row);
    setReviewCustomer(
      row.base_party_name ||
        row.customer_name ||
        row.customer_display_name ||
        row.party_display_name ||
        "",
    );
    setForm({
      payment_type: row.party_role === "contractor" ? "out" : "income",
      party_category: row.party_category || "retail",
      base_party_name:
        row.base_party_name ||
        row.customer_name ||
        row.customer_display_name ||
        "",
      project: row.project || "",
      building_unit: row.building_unit || "",
      work_type: row.work_type || "",
      amount: Math.abs(Number(row.collection_amount || 0)) || "",
      entry_date: dateInputValue(
        row.entry_date || new Date().toISOString().slice(0, 10),
      ),
      note: row.collection_note || row.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deletePayment(row) {
    const label = row.party_role === "contractor" ? "خصم" : "تحصيل";
    if (
      !window.confirm(
        `حذف ${label} ${row.document_operation_no || row.operation_no || row.id}؟`,
      )
    )
      return;
    setBusy(true);
    try {
      await api.request(`/api/entries/${row.id}`, { method: "DELETE" });
      setRecent((current) => current.filter((item) => item.id !== row.id));
      setMessage("تم حذف الدفعة.");
      await refreshAll();
    } catch (error) {
      setMessage(`تعذر حذف الدفعة: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function savePayment(event) {
    event.preventDefault();
    if (!canUser(currentUser, "can_create_payments")) {
      setMessage("هذا المستخدم غير مسموح له بتسجيل الدفعات.");
      return;
    }
    if (!String(form.base_party_name || "").trim()) {
      setMessage("لا يمكن حفظ الدفعة قبل اختيار أو كتابة اسم العميل.");
      return;
    }
    setBusy(true);
    try {
      const isOut = isContractorMode;
      const paymentLabel = isOut ? "\u062e\u0635\u0645" : "\u062a\u062d\u0635\u064a\u0644";
      const paymentPayload = {
        ...(editingPayment || {}),
        ...form,
        party_role: isOut ? "contractor" : "customer",
        document_type: "payment",
        document_status: "approved",
        accounting_status: isOut ? "خصم" : "تحصيل",
        customer_name: form.base_party_name,
        base_party_name: form.base_party_name,
        collection_amount: form.amount,
        collection_note: form.note,
        unit_code: "count",
        item_count: 0,
        total_quantity: 0,
        rate: 0,
        work_type: form.work_type || paymentLabel,
        description: form.work_type || paymentLabel,
        created_by: currentUser?.display_name,
        updated_by: currentUser?.display_name,
      };
      const saved = editingPayment
        ? await api.request(`/api/entries/${editingPayment.id}`, {
            method: "PUT",
            body: JSON.stringify(paymentPayload),
          })
        : await api.request("/api/payments", {
            method: "POST",
            body: JSON.stringify(paymentPayload),
          });
      setRecent((current) => {
        const displaySaved = {
          ...saved,
          document_operation_no:
            saved.document_operation_no ||
            editingPayment?.document_operation_no ||
            editingPayment?.operation_no ||
            saved.operation_no,
        };
        const next = current.filter((row) => row.id !== displaySaved.id);
        return [displaySaved, ...next].sort(
          (a, b) =>
            String(b.entry_date || "").localeCompare(
              String(a.entry_date || ""),
            ) || Number(b.id || 0) - Number(a.id || 0),
        );
      });
      setMessage(
        editingPayment ? "تم تعديل الدفعة." : "تم حفظ الدفعة كحركة مستقلة.",
      );
      resetPaymentForm({ keepCustomer: true });
      await refreshAll();
    } catch (error) {
      setMessage(`لم يتم حفظ الدفعة: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <form className="panel payments-panel" onSubmit={savePayment}>
        <div className="panel-head">
          <h2>
            <WalletCards size={18} />{" "}
            {editingPayment ? "تعديل دفعة" : "الدفعات"}
          </h2>
          {editingPayment && (
            <span className="user-chip">
              {editingPayment.party_role === "contractor" ? "خصم" : "تحصيل"} -{" "}
              {editingPayment.document_operation_no ||
                editingPayment.operation_no ||
                editingPayment.id}
            </span>
          )}
        </div>
        <div className="form-grid">
          <Field label="نوع الحركة">
            <input
              value={isContractorMode ? "دفعة / خصم مقاول" : "تحصيل عميل"}
              readOnly
            />
          </Field>
          <Field label="التصنيف">
            <select
              value={form.party_category}
              onChange={(event) => update("party_category", event.target.value)}
            >
              <option value="unselected">بدون تصنيف</option>
              <option value="retail">فرد</option>
              <option value="engineer">مهندس</option>
              <option value="corporate">شركة</option>
            </select>
          </Field>
          <ComboField
            label={
              form.payment_type === "out"
                ? "اسم المقاول بدون م. أو شركة"
                : "اسم العميل بدون م. أو شركة"
            }
            value={form.base_party_name}
            options={customerNames}
            onChange={updateCustomer}
          />
          <ComboField
            label="المشروع"
            value={form.project}
            options={projectOptions}
            onChange={(value) => update("project", value)}
          />
          <ComboField
            label="المبنى / الوحدة"
            value={form.building_unit}
            options={buildingOptions}
            onChange={(value) => update("building_unit", value)}
          />
          <ComboField
            label="بيان الأعمال"
            value={form.work_type}
            options={paymentWorkTypeOptions}
            onChange={(value) => update("work_type", value)}
          />
          <Field label="قيمة الدفعة">
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => update("amount", event.target.value)}
              required
            />
          </Field>
          <Field label="التاريخ">
            <input
              type="date"
              value={dateInputValue(form.entry_date)}
              onChange={(event) => update("entry_date", event.target.value)}
            />
          </Field>
          <Field label="ملاحظة">
            <input
              value={form.note}
              onChange={(event) => update("note", event.target.value)}
            />
          </Field>
        </div>
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            <Save size={18} /> {editingPayment ? "حفظ التعديل" : "حفظ الدفعة"}
          </button>
          {editingPayment && (
            <button
              type="button"
              onClick={() => resetPaymentForm({ keepCustomer: true })}
              disabled={busy}
            >
              إلغاء التعديل
            </button>
          )}
        </div>
      </form>
      <section className="panel">
        <div className="panel-head">
          <h2>مراجعة الدفعات</h2>
        </div>
        <div className="history-filter-row">
          <ComboField
            label="اختيار الطرف"
            value={reviewCustomer}
            options={paymentCustomerNames}
            onChange={setReviewCustomer}
          />
          <button type="button" onClick={() => setReviewCustomer("")}>
            كل الدفعات
          </button>
        </div>
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>الطرف</th>
                <th>المشروع</th>
                <th>الوحدة</th>
                <th>بيان الأعمال</th>
                <th>المبلغ</th>
                <th>ملاحظة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visiblePayments.map((row) => (
                <tr
                  key={row.id}
                  className={
                    editingPayment?.id === row.id ? "active-edit-row" : ""
                  }
                >
                  <td>{text(row.entry_date)}</td>
                  <td>
                    <span className={`status-badge ${row.party_role === "contractor" ? "status-closed" : "status-approved"}`}>
                      {row.party_role === "contractor" ? "خصم" : "تحصيل"}
                    </span>
                  </td>
                  <td>
                    {text(row.customer_display_name || row.customer_name)}
                  </td>
                  <td>{text(row.project)}</td>
                  <td>{text(row.building_unit)}</td>
                  <td>{text(row.work_type)}</td>
                  <td>{money(Math.abs(Number(row.collection_amount || 0)))}</td>
                  <td>{text(row.collection_note)}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title="تعديل الدفعة"
                      onClick={() => editPayment(row)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      title="حذف الدفعة"
                      onClick={() => deletePayment(row)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!visiblePayments.length && (
                <tr>
                  <td colSpan="7">لا توجد دفعات لهذا الاختيار</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EntryEditor({
  api,
  lookups,
  entryForm,
  setEntryForm,
  setEntryDirty,
  editingId,
  setEditingId,
  saveEntry,
  editorContext,
  onEditRow,
  onDeleteRow,
  setMessage,
  onCloseContext,
  onBack,
  busy,
  currentUser,
  refreshAll,
  onDocumentSaved,
  scopeRole = "customer",
}) {
  const [nextDoc, setNextDoc] = useState(null);
  const meta = documentTypeMeta(entryForm.document_type);
  const partyOptions =
    entryForm.party_role === "contractor"
      ? lookups.contractors
      : lookups.customers;
  const sourceCustomerOptions = uniqueValues(
    (lookups.customers || []).map(
      (party) => party.base_name || party.display_name,
    ),
  );
  const contextRows = editorContext?.reportData?.rows || [];
  const relatedProjects = uniqueValues([
    ...contextRows.map((row) => row.project),
    ...lookupValues(lookups.projects),
  ]);
  const relatedBuildings = uniqueValues(
    contextRows.map((row) => row.building_unit),
  );
  const relatedWorkTypes = uniqueValues([
    ...contextRows.map((row) => row.work_type),
    ...lookupValues(lookups.workTypes),
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadNext() {
      if (editingId || entryForm.document_id) {
        setNextDoc(null);
        return;
      }
      try {
        const data = await api.request(
          `/api/next-document-no?type=${entryForm.document_type}`,
        );
        if (!cancelled) setNextDoc(data);
      } catch {
        if (!cancelled) setNextDoc(null);
      }
    }
    loadNext();
    return () => {
      cancelled = true;
    };
  }, [api, editingId, entryForm.document_id, entryForm.document_type]);

  function update(key, value) {
    setEntryForm({ ...entryForm, [key]: value });
  }

  function changeDocumentType(value) {
    const nextMeta = documentTypeMeta(value);
    setEntryForm({
      ...entryForm,
      document_type: value,
      document_status: nextMeta.status,
      party_role: nextMeta.role,
      ...(value === "price_offer" ? {} : { vat_terms_only: false }),
      ...(value === "contractor_certificate"
        ? {}
        : { source_customer_id: "", source_customer_name: "" }),
    });
  }

  function resetForm() {
    if (!window.confirm("سيتم مسح نموذج الإدخال الحالي فقط. هل تريد المتابعة؟"))
      return;
    setEntryForm(variantEntryDefaults());
    setEditingId(null);
    setEntryDirty?.(false);
  }

  const useSmartEditor = true;
  if (useSmartEditor || !editingId) {
    return (
      <SmartEntryEditor
        api={api}
        lookups={lookups}
        entryForm={entryForm}
        setEntryForm={setEntryForm}
        setEntryDirty={setEntryDirty}
        nextDoc={nextDoc}
        setEditingId={setEditingId}
        currentUser={currentUser}
        refreshAll={refreshAll}
        setMessage={setMessage}
        busy={busy}
        onBack={onCloseContext || onBack}
        editorContext={editorContext}
        onCloseContext={onCloseContext}
        onDocumentSaved={onDocumentSaved}
        scopeRole={scopeRole}
      />
    );
  }

  return (
    <div className="page-stack">
      <form className="panel entry-editor" onSubmit={saveEntry}>
        <div className="panel-head">
          <h2>{editingId ? "تعديل بند" : "بند جديد"}</h2>
          <div className="document-id">
            <span>ID</span>
            <strong>
              {entryForm.operation_no ||
                entryForm.serial ||
                nextDoc?.operation_no ||
                "Auto"}
            </strong>
          </div>
        </div>

        <div className="entry-layout">
          <section className="form-section fixed-data-section">
            <h3>بيانات ثابتة للمستند</h3>
            <div className="form-grid">
              <Field label="نوع المستند">
                <select
                  value={entryForm.document_type}
                  disabled={!!APP_VARIANT.forcedDocumentType}
                  onChange={(event) => changeDocumentType(event.target.value)}
                >
                  {DOCUMENT_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الطرف">
                <select
                  value={entryForm.party_role}
                  onChange={(event) => update("party_role", event.target.value)}
                >
                  <option value="customer">عميل</option>
                  <option value="contractor">مقاول</option>
                </select>
              </Field>
              <Field label="التصنيف">
                <select
                  value={entryForm.party_category}
                  onChange={(event) =>
                    update("party_category", event.target.value)
                  }
                >
                  <option value="unselected">بدون تصنيف</option>
                  <option value="retail">فرد</option>
                  <option value="engineer">مهندس</option>
                  <option value="corporate">شركة</option>
                </select>
              </Field>
              <ComboField
                label="اسم الطرف بدون م. أو شركة"
                value={entryForm.base_party_name || ""}
                options={partyOptions.map(
                  (party) => party.base_name || party.display_name,
                )}
                onChange={(value) => {
                  const existing = partyOptions.find(
                    (party) =>
                      (party.base_name || party.display_name) === value,
                  );
                  setEntryForm((current) => ({
                    ...current,
                    base_party_name: value,
                    customer_name: value,
                    party_id: existing?.id || current.party_id || "",
                    party_category:
                      existing?.category || current.party_category,
                    customer_display_name:
                      existing?.display_name || current.customer_display_name,
                  }));
                }}
              />
              <ComboField
                label="المشروع"
                value={entryForm.project || ""}
                options={relatedProjects}
                onChange={(value) => update("project", value)}
              />
              <ComboField
                label="المبنى / الوحدة"
                value={entryForm.building_unit || ""}
                options={relatedBuildings}
                onChange={(value) => update("building_unit", value)}
              />
              <ComboField
                label="نوع الأعمال"
                value={entryForm.work_type || ""}
                options={relatedWorkTypes}
                onChange={(value) => update("work_type", value)}
              />
            </div>
          </section>

          <section className="form-section">
            <h3>توصيفات الأعمال</h3>
            <div className="form-grid two">
              <Field label="بيان">
                <textarea
                  value={entryForm.description || ""}
                  onChange={(event) =>
                    update("description", event.target.value)
                  }
                />
              </Field>
              <Field label="توصيف إضافي/زجاج">
                <textarea
                  value={entryForm.glass_spec || ""}
                  onChange={(event) => update("glass_spec", event.target.value)}
                />
              </Field>
              <Field label="توصيف إضافي/القطاع">
                <textarea
                  value={entryForm.profile_spec || ""}
                  onChange={(event) =>
                    update("profile_spec", event.target.value)
                  }
                />
              </Field>
              <Field label="اللون">
                <textarea
                  value={entryForm.color || ""}
                  onChange={(event) => update("color", event.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="form-section">
            <h3>الكميات والحساب</h3>
            <div className="form-grid">
              <Field label="الوحدة">
                <select
                  value={entryForm.unit_code}
                  onChange={(event) => update("unit_code", event.target.value)}
                >
                  {UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="طريقة القياس">
                <select
                  value={entryForm.measurement_mode}
                  onChange={(event) =>
                    update("measurement_mode", event.target.value)
                  }
                >
                  <option value="standard">قياسي</option>
                  <option value="engineering">هندسي</option>
                </select>
              </Field>
              <Field label="العدد">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.item_count || ""}
                  onChange={(event) => update("item_count", event.target.value)}
                />
              </Field>
              <Field label="العرض سم">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.width_cm || ""}
                  onChange={(event) => update("width_cm", event.target.value)}
                />
              </Field>
              <Field label="الارتفاع سم">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.height_cm || ""}
                  onChange={(event) => update("height_cm", event.target.value)}
                />
              </Field>
              <Field label="كمية مباشرة">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.total_quantity || ""}
                  onChange={(event) =>
                    update("total_quantity", event.target.value)
                  }
                />
              </Field>
              <Field label="الفئة">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.rate || ""}
                  onChange={(event) => update("rate", event.target.value)}
                />
              </Field>
              <Field label="سعر ثابت للوحدة">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.building_unit_price || ""}
                  onChange={(event) =>
                    update("building_unit_price", event.target.value)
                  }
                />
              </Field>
            </div>
          </section>

          <section className="form-section">
            <h3>الضرائب والتأمينات</h3>
            <div className="tax-grid">
              {TAXES.map((tax) => (
                <label key={tax.key} className="check-tile">
                  <input
                    type="checkbox"
                    checked={!!entryForm[tax.key]}
                    onChange={(event) => update(tax.key, event.target.checked)}
                  />
                  <span>{tax.label}</span>
                </label>
              ))}
              {entryForm.document_type === "price_offer" && (
                <label className="check-tile vat-terms-only-tile">
                  <input
                    type="checkbox"
                    checked={!!entryForm.vat_terms_only}
                    onChange={(event) =>
                      update(VAT_TERMS_ONLY_OPTION.key, event.target.checked)
                    }
                  />
                  <span>{VAT_TERMS_ONLY_OPTION.label}</span>
                </label>
              )}
            </div>
          </section>
        </div>

        <datalist id="partyNames">
          {partyOptions.map((party) => (
            <option
              key={party.id || party.display_name}
              value={party.base_name || party.display_name}
            />
          ))}
        </datalist>
        <datalist id="projects">
          {(lookups.projects || []).map((item) => (
            <option key={item.value} value={item.value} />
          ))}
        </datalist>
        <datalist id="workTypes">
          {(lookups.workTypes || []).map((item) => (
            <option key={item.value} value={item.value} />
          ))}
        </datalist>

        <div className="form-actions">
          <button className="primary" disabled={busy}>
            <Save size={18} /> حفظ
          </button>
          <button
            type="button"
            title="مسح نموذج الإدخال الحالي بعد تأكيد"
            onClick={resetForm}
          >
            <Plus size={18} /> مسح النموذج
          </button>
          <span>
            {meta.label} / {statusLabel(entryForm.document_status)}
          </span>
        </div>
      </form>
      {editorContext?.reportData && (
        <section className="panel linked-report">
          <div className="panel-head">
            <h2>التقرير المفتوح أثناء التعديل</h2>
            <button type="button" onClick={onCloseContext}>
              إغلاق التقرير
            </button>
          </div>
          <DocumentPreview
            data={editorContext.reportData}
            onEditRow={(row) => onEditRow(row, editorContext)}
            onDeleteRow={onDeleteRow}
            onClose={onCloseContext}
          />
        </section>
      )}
    </div>
  );
}

const SMART_ROW_TEMPLATE = {
  work_type: "",
  building_unit: "",
  floor_apartment: "",
  description: "",
  glass_spec: "",
  profile_spec: "",
  color: "",
  unit_code: "sqm",
  measurement_mode: "standard",
  item_count: "",
  width_cm: "",
  height_cm: "",
  total_quantity: "",
  rate: "",
  completion_ratio: "",
  building_unit_price: "",
};

const SMART_NUMERIC_CLIPBOARD_KEYS = new Set([
  "item_count",
  "width_cm",
  "height_cm",
  "total_quantity",
  "rate",
  "completion_ratio",
  "building_unit_price",
]);

let smartGridRowSequence = 0;

function nextSmartGridRowId(existingId = "") {
  if (existingId) return `db:${existingId}`;
  smartGridRowSequence += 1;
  return `draft:${Date.now().toString(36)}:${smartGridRowSequence.toString(36)}`;
}

function normalizeSmartClipboardValue(value, key) {
  return SMART_NUMERIC_CLIPBOARD_KEYS.has(key)
    ? normalizeSmartNumericClipboardValue(value)
    : String(value ?? "");
}

function smartRowFrom() {
  return {
    ...SMART_ROW_TEMPLATE,
    _gridId: nextSmartGridRowId(),
    _gridGhost: true,
    _touched: {},
  };
}

function manualBlankSmartRow() {
  return {
    ...smartRowFrom(),
    _gridGhost: false,
    _manualBlank: true,
  };
}

function smartRowFromExisting(row = {}) {
  return {
    ...SMART_ROW_TEMPLATE,
    _existingId: row.id || "",
    _gridId: nextSmartGridRowId(row.id || ""),
    _gridGhost: false,
    _originalBuildingUnit: row.building_unit || "",
    _originalFloorApartment: row.floor_apartment || "",
    work_type: row.work_type || "",
    building_unit: row.building_unit || "",
    floor_apartment: row.floor_apartment || "",
    description: row.description || row.statement_text || "",
    glass_spec: row.glass_spec || "",
    profile_spec: row.profile_spec || "",
    color: row.color || "",
    unit_code: row.unit_code || "sqm",
    measurement_mode: row.measurement_mode || "standard",
    item_count: row.item_count || "",
    width_cm: row.width_cm || "",
    height_cm: row.height_cm || "",
    total_quantity: row.total_quantity || "",
    rate: row.rate || "",
    completion_ratio: row.completion_ratio || row.completion_percent || "",
    building_unit_price: row.building_unit_price || "",
    _touched: {
      building_unit: !!row.building_unit,
      floor_apartment: !!row.floor_apartment,
      description: !!(row.description || row.statement_text),
      glass_spec: !!row.glass_spec,
      profile_spec: !!row.profile_spec,
      color: !!row.color,
    },
  };
}

function rowHasData(row) {
  const touched = row._touched || {};
  const realValues = [
    row.work_type,
    row.description,
    touched.building_unit && row.building_unit,
    touched.floor_apartment && row.floor_apartment,
    touched.glass_spec && row.glass_spec,
    touched.profile_spec && row.profile_spec,
    touched.color && row.color,
    row.item_count,
    row.width_cm,
    row.height_cm,
    row.total_quantity,
    row.rate,
    row.building_unit_price,
  ];
  return realValues.some((value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return false;
    const numeric = Number(normalized.replace(/,/g, ""));
    return !Number.isFinite(numeric) || numeric !== 0;
  });
}

function rowUnitLabel(unitCode) {
  const normalized = normalizeClientUnitCode(unitCode);
  return UNITS.find((unit) => unit.value === normalized)?.label || "م²";
}

function num(value) {
  const n = Number(
    String(value || "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(n) ? n : 0;
}

function paymentRowAmount(row = {}) {
  return Math.abs(
    num(row.payment_amount) ||
      num(row.collection_amount) ||
      num(row.net_total) ||
      num(row.gross_total),
  );
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function completionPercent(value) {
  const n = num(value);
  if (!n) return 100;
  return roundMoney(n <= 1 ? n * 100 : n);
}

function completionFactor(value) {
  return completionPercent(value) / 100;
}

function formatCompletionPercent(row = {}) {
  return `${money(completionPercent(row.completion_percent ?? row.completion_ratio))}%`;
}

const USER_PERMISSION_FIELDS = [
  {
    key: "can_create_invoices",
    label: "إنشاء فواتير معتمدة",
    shortLabel: "فواتير",
    title: "السماح بإنشاء فواتير معتمدة",
  },
  {
    key: "can_create_payments",
    label: "تسجيل دفعات",
    shortLabel: "دفعات",
    title: "السماح بتسجيل دفعات",
  },
  {
    key: "can_change_status",
    label: "تغيير حالة المستند",
    shortLabel: "حالة المستند",
    title: "السماح بتغيير حالة المستند",
  },
  {
    key: "can_edit_terms",
    label: "تعديل الشروط والأحكام",
    shortLabel: "الشروط",
    title: "السماح بتعديل الشروط والأحكام",
  },
  {
    key: "can_edit_company_settings",
    label: "تعديل إعدادات الشركة",
    shortLabel: "إعدادات الشركة",
    title: "السماح بتعديل بيانات الشركة وإعداداتها",
  },
  {
    key: "can_edit_table_styles",
    label: "تعديل استايلات الجداول",
    shortLabel: "استايلات الجداول",
    title: "السماح بتعديل ألوان وخطوط الجداول والتقارير",
  },
];

function canUser(user, permission) {
  return ["admin", "manager"].includes(user?.role) || !!user?.[permission];
}

function calculateDraftRow(row, fixed) {
  const unitCode = normalizeClientUnitCode(
    row.unit_code || fixed.unit_code || "sqm",
  );
  const mode = row.measurement_mode || fixed.measurement_mode || "standard";
  const count = num(row.item_count);
  const width = num(row.width_cm);
  const height = num(row.height_cm);
  const direct = num(row.total_quantity);
  const rate = num(row.rate);
  const fixedTotal = num(row.building_unit_price);
  let quantity = 0;
  let area = 0;
  if (!width && !height) {
    quantity = direct;
  } else if (unitCode === "lm") {
    quantity = roundMoney((width / 100) * (count || 1));
  } else if (unitCode === "count") {
    quantity = direct || count || 1;
  } else {
    const itemArea = (width / 100) * (height / 100);
    area = itemArea * (count || 1);
    quantity =
      mode === "engineering"
        ? roundMoney(area)
        : itemArea < 1
          ? count || 1
          : roundMoney(area);
  }
  if (!area && width && height)
    area = roundMoney((width / 100) * (height / 100) * (count || 1));
  const gross = fixedTotal || roundMoney(quantity * rate);
  const contractorTax = fixed.contractor_tax_enabled ? gross * 0.01 : 0;
  const vatBase = Math.max(gross - contractorTax, 0);
  const vat = fixed.vat_enabled && vatBase >= 1 ? vatBase * 0.14 : 0;
  const postVat = vatBase + vat;
  const social = fixed.social_insurance_enabled ? postVat * 0.036 : 0;
  const stamp = fixed.stamp_enabled ? postVat * 0.001 : 0;
  const works = fixed.works_insurance_enabled ? postVat * 0.05 : 0;
  const finalInsurance = fixed.final_insurance_enabled ? postVat * 0.05 : 0;
  const net = postVat - social - stamp - works - finalInsurance;
  const percent = completionPercent(
    row.completion_ratio || fixed.completion_ratio,
  );
  const factor = completionFactor(
    row.completion_ratio || fixed.completion_ratio,
  );
  return {
    ...row,
    unit_code: unitCode,
    measurement_mode: mode,
    completion_ratio: row.completion_ratio || "",
    completion_percent: percent,
    unit: rowUnitLabel(unitCode),
    quantity: roundMoney(quantity),
    area_m2: roundMoney(area),
    gross_total: roundMoney(gross),
    net_total: roundMoney(net),
    work_gross_total: roundMoney(gross * factor),
    work_net_total: roundMoney(net * factor),
    vat_amount: roundMoney(vat),
    work_vat_amount: roundMoney(vat * factor),
    social_insurance_amount: roundMoney(social),
    work_social_insurance_amount: roundMoney(social * factor),
    stamp_amount: roundMoney(stamp),
    work_stamp_amount: roundMoney(stamp * factor),
    works_insurance_amount: roundMoney(works),
    work_works_insurance_amount: roundMoney(works * factor),
    final_insurance_amount: roundMoney(finalInsurance),
    work_final_insurance_amount: roundMoney(finalInsurance * factor),
    contractor_tax_amount: roundMoney(contractorTax),
    work_contractor_tax_amount: roundMoney(contractorTax * factor),
    statement_text: [
      row.description,
      row.glass_spec,
      row.profile_spec,
      row.color,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function SmartCellTextInput({
  value,
  editSessionId = 0,
  onDraftChange,
  onCommit,
  onBlur,
  ...props
}) {
  const externalValue = String(value ?? "");
  const [draftValue, setDraftValue] = useState(externalValue);
  const lastExternalValueRef = useRef(externalValue);
  const draftRef = useRef(externalValue);
  const sessionRef = useRef(editSessionId);

  useEffect(() => {
    sessionRef.current = editSessionId;
  }, [editSessionId]);

  useEffect(() => {
    if (externalValue === lastExternalValueRef.current) return;
    lastExternalValueRef.current = externalValue;
    draftRef.current = externalValue;
    setDraftValue(externalValue);
  }, [externalValue, editSessionId]);

  return (
    <input
      {...props}
      value={draftValue}
      onChange={(event) => {
        const startedAt = performanceStart();
        const nextValue = event.target.value;
        draftRef.current = nextValue;
        setDraftValue(nextValue);
        onDraftChange?.(nextValue, event, sessionRef.current);
        logDevelopmentPerformance("Cell draft update", startedAt);
      }}
      onKeyDown={(event) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          event.stopPropagation();
        }
        props.onKeyDown?.(event);
      }}
      onBlur={(event) => {
        onCommit?.(draftRef.current, event, sessionRef.current);
        onBlur?.(event);
      }}
    />
  );
}

function SmartMultilineInput({
  value,
  editSessionId = 0,
  onDraftChange,
  onCommit,
  onBlur,
  onPaste,
  ...props
}) {
  const editorRef = useRef(null);
  const lastExternalValueRef = useRef(null);
  const draftRef = useRef(String(value || ""));
  const sessionRef = useRef(editSessionId);

  useEffect(() => {
    sessionRef.current = editSessionId;
  }, [editSessionId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = String(value || "");
    if (next === lastExternalValueRef.current) return;
    lastExternalValueRef.current = next;
    draftRef.current = next;
    if (editor.innerText !== next) editor.innerText = next;
  }, [value, editSessionId]);

  return (
    <div
      {...props}
      ref={editorRef}
      className={`smart-cell-text-input ${props.className || ""}`.trim()}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      onInput={(event) => {
        const startedAt = performanceStart();
        const nextValue = event.currentTarget.innerText;
        draftRef.current = nextValue;
        onDraftChange?.(nextValue, event, sessionRef.current);
        logDevelopmentPerformance("Cell draft update", startedAt);
      }}
      onKeyDown={(event) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          event.stopPropagation();
        }
        props.onKeyDown?.(event);
      }}
      onBlur={(event) => {
        draftRef.current = event.currentTarget.innerText;
        onCommit?.(draftRef.current, event, sessionRef.current);
        onBlur?.(event);
      }}
      onPaste={(event) => onPaste?.(event)}
    />
  );
}

function ConfirmationLayer({ dialog, onResult }) {
  if (!dialog) return null;
  return (
    <div
      className={`confirmation-layer${dialog.danger ? " danger" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-layer-title"
      dir="rtl"
    >
      <div className="confirmation-card">
        <AlertTriangle size={48} />
        <h2 id="confirmation-layer-title">{dialog.title || "تأكيد الإجراء"}</h2>
        <p>{dialog.message}</p>
        <div className="confirmation-actions">
          <button type="button" onClick={() => onResult(false)} autoFocus>
            إلغاء
          </button>
          <button
            type="button"
            className={dialog.danger ? "danger" : "primary"}
            onClick={() => onResult(true)}
          >
            {dialog.confirmLabel || "تأكيد"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SmartTableSearchPanel({
  initialQuery,
  results,
  currentIndex,
  columnLabel,
  onSearchChange,
  onClose,
  onPrevious,
  onNext,
  onJump,
  onReplaceAll,
}) {
  const [query, setQuery] = useState(initialQuery || "");
  const [replacement, setReplacement] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => onSearchChange(query), 120);
    return () => window.clearTimeout(timer);
  }, [onSearchChange, query]);

  const safeCurrentIndex =
    results.length && currentIndex >= 0
      ? Math.min(currentIndex, results.length - 1)
      : 0;
  const resultWindowStart = Math.max(
    0,
    Math.min(
      safeCurrentIndex - 30,
      Math.max(0, results.length - 80),
    ),
  );
  const visibleResults = results.slice(
    resultWindowStart,
    resultWindowStart + 80,
  );

  function highlightedValue(result) {
    const text = String(result.value || "");
    const start = Math.max(0, result.matchRange?.start || 0);
    const end = Math.max(start, result.matchRange?.end || start);
    return (
      <span className="smart-search-result-value">
        {text.slice(0, start)}
        <mark>{text.slice(start, end)}</mark>
        {text.slice(end)}
      </span>
    );
  }

  return (
    <section
      className="smart-table-search-panel"
      dir="rtl"
      aria-label="بحث واستبدال في الجدول"
    >
      <div className="smart-search-head">
        <strong>بحث في الجدول</strong>
        <button
          type="button"
          className="icon-button"
          title="إغلاق البحث"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <input
        ref={inputRef}
        data-smart-search-input="true"
        value={query}
        placeholder="اكتب النص أو الرقم المطلوب..."
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
        }}
      />
      <label className="smart-search-replace-field">
        <span>استبدال بـ:</span>
        <input
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </label>
      <div className="smart-search-actions">
        <span>
          {results.length
            ? `${safeCurrentIndex + 1} من ${results.length}`
            : "0 نتيجة"}
        </span>
        <button type="button" onClick={onPrevious} disabled={!results.length}>
          السابق
        </button>
        <button type="button" onClick={onNext} disabled={!results.length}>
          التالي
        </button>
        <button
          type="button"
          className="primary"
          disabled={!query.trim() || !results.length}
          onClick={() => onReplaceAll(query, replacement)}
        >
          استبدال الكل
        </button>
      </div>
      {!!results.length && (
        <div className="smart-search-results" role="list">
          {visibleResults.map((result, windowIndex) => {
            const resultIndex = resultWindowStart + windowIndex;
            return (
              <article
                key={`${result.rowId}:${result.columnKey}`}
                className={
                  resultIndex === safeCurrentIndex ? "current-result" : ""
                }
                role="listitem"
              >
                <div>
                  <strong>
                    الصف {result.visibleRowNumber} —{" "}
                    {columnLabel(result.columnKey)}
                  </strong>
                  {highlightedValue(result)}
                </div>
                <button
                  type="button"
                  onClick={() => onJump(result, resultIndex)}
                >
                  انتقال
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SmartEntryEditor({
  api,
  lookups,
  entryForm,
  setEntryForm,
  setEntryDirty,
  nextDoc,
  setEditingId,
  currentUser,
  refreshAll,
  setMessage,
  busy,
  onBack,
  editorContext,
  onCloseContext,
  onDocumentSaved,
  scopeRole = "customer",
}) {
  const gridRenderStartedAt = performanceStart();
  const [rows, setRows] = useState([smartRowFrom(entryForm)]);
  const [deletedRowIds, setDeletedRowIds] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeCell, setActiveCell] = useState("");
  const [editingCell, setEditingCell] = useState("");
  const [activeEditSession, setActiveEditSession] = useState(0);
  const [suggestionRect, setSuggestionRect] = useState(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [rowHeight, setRowHeight] = useState(52);
  const [columnWidths, setColumnWidths] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("smartTableColumnWidthsV2") || "{}");
    } catch {
      return {};
    }
  });
  const [rangeSelection, setRangeSelection] = useState(null);
  const [cellMenu, setCellMenu] = useState(null);
  const [rowMenu, setRowMenu] = useState(null);
  const [columnMenu, setColumnMenu] = useState(null);
  const [columnFilterQuery, setColumnFilterQuery] = useState("");
  const [smartSort, setSmartSort] = useState(null);
  const [smartFilters, setSmartFilters] = useState({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [currentSearchResultIndex, setCurrentSearchResultIndex] = useState(0);
  const [, setSuggestionDraftVersion] = useState(0);
  const [fillPreview, setFillPreview] = useState(null);
  const [certificateInfo, setCertificateInfo] = useState(null);
  const [confirmationDialog, setConfirmationDialog] = useState(null);
  const [smartViewport, setSmartViewport] = useState({
    scrollTop: 0,
    height: 640,
  });
  const rowHeightRef = useRef(rowHeight);
  const rowsRef = useRef(rows);
  const deletedRowIdsRef = useRef(deletedRowIds);
  const undoStackRef = useRef(undoStack);
  const redoStackRef = useRef(redoStack);
  const dragFillRef = useRef(null);
  const suggestionTimerRef = useRef(null);
  const confirmationResolverRef = useRef(null);
  const smartClipboardRef = useRef({ text: "", grid: [] });
  const cellDraftsRef = useRef(new Map());
  const suggestionCommittedCellsRef = useRef(new Set());
  const copyShortcutHandlerRef = useRef(null);
  const pasteShortcutHandlerRef = useRef(null);
  const historyShortcutHandlerRef = useRef(null);
  const smartTableScrollRef = useRef(null);
  const smartViewportFrameRef = useRef(0);
  const suggestionDraftFrameRef = useRef(0);
  const gridRevisionRef = useRef(0);
  const nativeHistoryUntilRef = useRef(0);
  const rangeSelectionRef = useRef(rangeSelection);
  const editingCellRef = useRef(editingCell);
  const activeEditSessionRef = useRef(activeEditSession);
  const editingSessionCellRef = useRef("");
  const activeCellRef = useRef(activeCell);
  const activeSuggestionIndexRef = useRef(activeSuggestionIndex);
  const smartViewRowsRef = useRef([]);
  const smartSortRef = useRef(smartSort);
  const smartFiltersRef = useRef(smartFilters);
  const searchResultsRef = useRef(searchResults);
  const currentSearchResultIndexRef = useRef(currentSearchResultIndex);
  const meta = documentTypeMeta(entryForm.document_type);

  rangeSelectionRef.current = rangeSelection;
  editingCellRef.current = editingCell;
  activeEditSessionRef.current = activeEditSession;
  activeCellRef.current = activeCell;
  activeSuggestionIndexRef.current = activeSuggestionIndex;
  smartSortRef.current = smartSort;
  smartFiltersRef.current = smartFilters;
  searchResultsRef.current = searchResults;
  currentSearchResultIndexRef.current = currentSearchResultIndex;
  undoStackRef.current = undoStack;
  redoStackRef.current = redoStack;

  historyShortcutHandlerRef.current = (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    const key = String(event.key || "").toLowerCase();
    const isSearch = event.code === "KeyF" || key === "f";
    if (isSearch) {
      const target = event.target;
      const gridIsActive =
        !!target?.closest?.(
          ".smart-entry-table, .cell-suggestions, .smart-table-search-panel",
        ) || !!rangeSelectionRef.current;
      if (!gridIsActive) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (
        editingCellRef.current &&
        hasUncommittedSmartCellDraft(editingCellRef.current)
      ) {
        const separator = editingCellRef.current.indexOf(":");
        const index = Number(editingCellRef.current.slice(0, separator));
        const columnKey = editingCellRef.current.slice(separator + 1);
        commitSmartCellEdit(index, columnKey);
      }
      window.clearTimeout(suggestionTimerRef.current);
      updateSmartEditingCell("");
      updateSmartActiveCell("");
      setSuggestionRect(null);
      updateSmartSuggestionIndex(-1);
      setCellMenu(null);
      setRowMenu(null);
      setSearchOpen(true);
      window.requestAnimationFrame(() => {
        const searchInput = document.querySelector(
          "[data-smart-search-input='true']",
        );
        searchInput?.focus({ preventScroll: true });
        searchInput?.select?.();
      });
      return;
    }
    const isUndo =
      (event.code === "KeyZ" || key === "z") && !event.shiftKey;
    const isRedo =
      event.code === "KeyY" ||
      key === "y" ||
      ((event.code === "KeyZ" || key === "z") && event.shiftKey);
    if (!isUndo && !isRedo) return;

    const target = event.target;
    const insideGrid = !!target?.closest?.(
      ".smart-entry-table, .cell-suggestions",
    );
    if (!insideGrid) {
      if (isEditableFocusTarget(target)) return;
      if (!rangeSelectionRef.current) return;
    }
    if (
      editingCellRef.current &&
      hasUncommittedSmartCellDraft(editingCellRef.current)
    ) {
      // The native editor owns undo while its text buffer is uncommitted.
      nativeHistoryUntilRef.current = Date.now() + 120;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    window.clearTimeout(suggestionTimerRef.current);
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    setCellMenu(null);
    setRowMenu(null);
    if (event.repeat) return;
    if (isUndo) undoSmartTable();
    else redoSmartTable();
  };

  useEffect(() => {
    const handleHistoryShortcut = (event) =>
      historyShortcutHandlerRef.current?.(event);
    document.addEventListener("keydown", handleHistoryShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleHistoryShortcut, true);
  }, []);

  function askForConfirmation(dialog) {
    return new Promise((resolve) => {
      confirmationResolverRef.current?.(false);
      confirmationResolverRef.current = resolve;
      setConfirmationDialog(dialog);
    });
  }

  function settleConfirmation(result) {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmationDialog(null);
    resolve?.(result);
    restoreInputInteractivity();
  }
  const partyOptions =
    scopeRole === "contractor"
      ? lookups.contractors
      : lookups.customers;
  const sourceCustomerOptions = uniqueValues(
    (lookups.customers || []).map(
      (party) => party.base_name || party.display_name,
    ),
  );
  const filteredParties = (partyOptions || []).filter(
    (party) =>
      entryForm.party_category === "unselected" ||
      !entryForm.party_category ||
      party.category === entryForm.party_category,
  );
  const rowData = rows
    .filter(rowHasData)
    .map((row) => ({ ...row, _touched: { ...(row._touched || {}) } }));
  const isDocumentEdit = !!editorContext?.document?.id;
  const scopedHistoryRows = historyRows.filter(
    (row) =>
      (!entryForm.project || row.project === entryForm.project) &&
      (!entryForm.work_type || row.work_type === entryForm.work_type),
  );
  const suggestionRows = scopedHistoryRows.length
    ? scopedHistoryRows
    : historyRows;
  const hasPartyHistory = historyRows.length > 0;
  const projectOptions = uniqueValues([
    ...historyRows.map((row) => row.project),
    ...(hasPartyHistory ? [] : lookupValues(lookups.projects)),
  ]);
  const buildingOptions = uniqueValues([
    entryForm.building_unit,
    ...rows.map((row) => row.building_unit),
    ...suggestionRows.map((row) => row.building_unit),
    ...(hasPartyHistory ? [] : lookupValues(lookups.buildingUnits)),
  ]);
  const unitOptions = uniqueValues([
    entryForm.floor_apartment,
    ...rows.map((row) => row.floor_apartment),
    ...suggestionRows.map((row) => row.floor_apartment),
    ...(hasPartyHistory ? [] : lookupValues(lookups.floorApartments)),
  ]);
  const workTypeOptions = uniqueValues([
    ...historyRows
      .filter((row) => !entryForm.project || row.project === entryForm.project)
      .map((row) => row.work_type),
    ...(hasPartyHistory ? [] : lookupValues(lookups.workTypes)),
  ]);
  const selectedWorkTypes = uniqueValues(
    entryForm.work_types?.length
      ? entryForm.work_types
      : entryForm.work_type
        ? [entryForm.work_type]
        : [],
  );
  const descriptionOptions = uniqueValues([
    ...rows.map((row) => row.description),
    ...suggestionRows.map((row) => row.description),
    ...lookupValues(lookups.descriptions),
  ]);
  const glassOptions = uniqueValues([
    ...rows.map((row) => row.glass_spec),
    ...suggestionRows.map((row) => row.glass_spec),
    ...lookupValues(lookups.glassSpecs),
  ]);
  const profileOptions = uniqueValues([
    ...rows.map((row) => row.profile_spec),
    ...suggestionRows.map((row) => row.profile_spec),
    ...lookupValues(lookups.profileSpecs),
  ]);
  const colorOptions = uniqueValues([
    ...rows.map((row) => row.color),
    ...suggestionRows.map((row) => row.color),
    ...lookupValues(lookups.colors),
  ]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    deletedRowIdsRef.current = deletedRowIds;
  }, [deletedRowIds]);

  useEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);

  useEffect(() => {
    localStorage.setItem("smartTableColumnWidthsV2", JSON.stringify(columnWidths));
  }, [columnWidths]);

  useLayoutEffect(() => {
    logDevelopmentPerformance("Grid render", gridRenderStartedAt);
  });

  useLayoutEffect(() => {
    const host = smartTableScrollRef.current;
    if (!host) return undefined;
    const updateViewport = () => {
      setSmartViewport({
        scrollTop: host.scrollTop,
        height: host.clientHeight || 640,
      });
    };
    updateViewport();
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(updateViewport)
        : null;
    observer?.observe(host);
    return () => observer?.disconnect();
  }, [tableExpanded]);
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      const name = String(entryForm.base_party_name || "").trim();
      try {
        const query = new URLSearchParams({ limit: "500" });
        if (entryForm.party_id) query.set("party_id", String(entryForm.party_id));
        else if (name) query.set("customer", name);
        let data = await api.request(`/api/entries?${query.toString()}`);
        if (!(data.rows || []).length && (entryForm.party_id || name)) {
          data = await api.request("/api/entries?limit=500");
        }
        if (!cancelled) setHistoryRows(data.rows || []);
      } catch {
        try {
          const fallback = await api.request("/api/entries?limit=500");
          if (!cancelled) setHistoryRows(fallback.rows || []);
        } catch {
          if (!cancelled) setHistoryRows([]);
        }
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [api, entryForm.base_party_name, entryForm.party_id]);

  useEffect(() => {
    if (!editorContext?.copyToken || !editorContext?.copyRows?.length) return;
    const copiedRows = editorContext.copyRows.map((row) => {
      const copied = smartRowFromExisting(row);
      delete copied._existingId;
      return copied;
    });
    setRows([...copiedRows, smartRowFrom()]);
    updateSmartSelection(null);
    setDeletedRowIds([]);
    setPreviewData(null);
    setEntryDirty?.(true);
  }, [editorContext?.copyToken]);

  useEffect(() => {
    if (!tableExpanded) return undefined;
    document.body.classList.add("smart-table-expanded");
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (activeCell || suggestionRect || document.querySelector(".cell-suggestions")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        updateSmartActiveCell("");
        setSuggestionRect(null);
        updateSmartSuggestionIndex(-1);
        return;
      }
      // With no suggestion list open, Escape deliberately does nothing here.
      // Expanded mode is changed only by its explicit toolbar button.
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("smart-table-expanded");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCell, suggestionRect, tableExpanded]);

  useEffect(
    () => () => {
      window.clearTimeout(suggestionTimerRef.current);
      window.cancelAnimationFrame(smartViewportFrameRef.current);
      window.cancelAnimationFrame(suggestionDraftFrameRef.current);
      confirmationResolverRef.current?.(false);
      confirmationResolverRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const closeSuggestionsFromOutside = (event) => {
      const target = event.target;
      if (target?.closest?.(".cell-combo, .cell-suggestions")) return;
      window.setTimeout(() => {
        updateSmartEditingCell("");
        updateSmartActiveCell("");
        setSuggestionRect(null);
        updateSmartSuggestionIndex(-1);
      }, 0);
    };
    document.addEventListener("pointerdown", closeSuggestionsFromOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeSuggestionsFromOutside, true);
  }, []);

  useLayoutEffect(() => {
    if (!editingCell || activeCell !== editingCell) return;
    const separator = editingCell.indexOf(":");
    const key = separator >= 0 ? editingCell.slice(separator + 1) : "";
    if (!key || !optionsForCell(key).length) return;
    const anchor =
      document.querySelector(`[data-smart-cell-container="${editingCell}"]`) ||
      document.querySelector(`[data-smart-cell="${editingCell}"]`);
    if (anchor) positionCellSuggestions(editingCell, anchor, { resetIndex: true });
  }, [activeCell, editingCell, historyRows.length, rows.length]);

  useEffect(() => {
    if (!activeCell) return undefined;
    const reposition = () => {
      const target =
        document.querySelector(`[data-smart-cell-anchor="${activeCell}"]`) ||
        document.querySelector(`[data-smart-cell="${activeCell}"]`);
      if (target) positionCellSuggestions(activeCell, target, { resetIndex: false });
    };
    const scrollHost = document.querySelector(".smart-table-scroll");
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    scrollHost?.addEventListener("scroll", reposition, { passive: true });
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      scrollHost?.removeEventListener("scroll", reposition);
    };
  }, [activeCell]);

  const baseSmartCellOrder = [
    "building_unit",
    "floor_apartment",
    "description",
    "glass_spec",
    "profile_spec",
    "color",
    "item_count",
    "width_cm",
    "height_cm",
    "unit_code",
    "total_quantity",
    "rate",
    "completion_ratio",
    "building_unit_price",
    "measurement_mode",
  ];
  const smartCellOrder =
    entryForm.document_type === "contractor_certificate"
      ? ["work_type", ...baseSmartCellOrder]
      : baseSmartCellOrder;
  const smartDisplayColumns = [
    { key: "__index", label: "#", width: 52 },
    ...(entryForm.document_type === "contractor_certificate"
      ? [{ key: "work_type", label: "نوع الأعمال", width: 140 }]
      : []),
    { key: "building_unit", label: "مبنى", width: 105 },
    { key: "floor_apartment", label: "وحدة", width: 105 },
    { key: "description", label: "بيان", width: 240 },
    { key: "glass_spec", label: "زجاج", width: 120 },
    { key: "profile_spec", label: "قطاع", width: 120 },
    { key: "color", label: "لون", width: 120 },
    { key: "item_count", label: "عدد", width: 86 },
    { key: "width_cm", label: "عرض سم", width: 90 },
    { key: "height_cm", label: "ارتفاع سم", width: 90 },
    { key: "unit_code", label: "الوحدة", width: 100 },
    { key: "total_quantity", label: "كمية مباشرة", width: 112 },
    { key: "rate", label: "فئة", width: 96 },
    { key: "completion_ratio", label: "نسبة العمل %", width: 112 },
    { key: "building_unit_price", label: "ثابت", width: 96 },
    { key: "measurement_mode", label: "قياس", width: 104 },
    { key: "__actions", label: "نسخ", width: 170 },
  ];
  const resolvedColumnWidth = (column) =>
    Number(columnWidths[column.key] || column.width);
  const smartTableWidth = smartDisplayColumns.reduce(
    (sum, column) => sum + resolvedColumnWidth(column),
    0,
  );

  function smartColumnLabel(columnKey) {
    return (
      smartDisplayColumns.find((column) => column.key === columnKey)?.label ||
      columnKey
    );
  }

  function visibleSmartCellValue(row, columnKey) {
    if (columnKey === "unit_code") {
      return (
        UNITS.find((unit) => unit.value === row?.unit_code)?.label ||
        row?.unit_code ||
        ""
      );
    }
    if (columnKey === "measurement_mode") {
      return row?.measurement_mode === "engineering"
        ? "هندسي"
        : row?.measurement_mode === "standard"
          ? "قياسي"
          : row?.measurement_mode || "";
    }
    return row?.[columnKey] ?? "";
  }

  function smartColumnType(columnKey) {
    if (SMART_NUMERIC_CLIPBOARD_KEYS.has(columnKey)) return "number";
    return "text";
  }

  function smartFilterValue(row, columnKey) {
    return String(visibleSmartCellValue(row, columnKey) ?? "").trim();
  }

  function smartFilterValueLabel(value) {
    return value ? value : "القيم الفارغة";
  }

  function smartFilterOptionValues(columnKey) {
    return [
      ...new Set(rows.map((row) => smartFilterValue(row, columnKey))),
    ].sort(
      (left, right) => compareSmartCellValues(left, right, smartColumnType(columnKey)),
    );
  }

  function compareSmartCellValues(leftValue, rightValue, type) {
    const leftText = String(leftValue ?? "").trim();
    const rightText = String(rightValue ?? "").trim();
    const leftBlank = !leftText;
    const rightBlank = !rightText;
    if (leftBlank && rightBlank) return 0;
    if (leftBlank) return 1;
    if (rightBlank) return -1;
    if (type === "number") {
      const leftNumber = Number(normalizeSmartNumericClipboardValue(leftText));
      const rightNumber = Number(normalizeSmartNumericClipboardValue(rightText));
      const leftNumeric = Number.isFinite(leftNumber);
      const rightNumeric = Number.isFinite(rightNumber);
      if (leftNumeric && rightNumeric) return leftNumber - rightNumber;
      if (leftNumeric) return -1;
      if (rightNumeric) return 1;
    }
    return naturalTextCompare(leftText, rightText);
  }

  const activeSmartFilterKeys = Object.keys(smartFilters).filter((columnKey) =>
    Array.isArray(smartFilters[columnKey]),
  );
  const smartViewRows = useMemo(() => {
    const startedAt = performanceStart();
    const filters = smartFilters || {};
    const sorted = smartSort?.key && smartSort?.direction;
    const entries = rows.map((row, index) => ({ row, index }));
    const ghostEntries = entries.filter(
      ({ row }) => row._gridGhost && !rowHasData(row),
    );
    const dataEntries = entries.filter(
      ({ row }) => !(row._gridGhost && !rowHasData(row)),
    );
    const filtered = dataEntries.filter(({ row }) =>
      Object.entries(filters).every(([columnKey, selectedValues]) => {
        if (!Array.isArray(selectedValues)) return true;
        return selectedValues.includes(smartFilterValue(row, columnKey));
      }),
    );
    if (sorted) {
      const directionFactor = smartSort.direction === "desc" ? -1 : 1;
      filtered.sort((left, right) => {
        const leftValue = smartFilterValue(left.row, smartSort.key);
        const rightValue = smartFilterValue(right.row, smartSort.key);
        const leftBlank = !leftValue;
        const rightBlank = !rightValue;
        if (leftBlank && rightBlank) return left.index - right.index;
        if (leftBlank) return 1;
        if (rightBlank) return -1;
        const result = compareSmartCellValues(
          leftValue,
          rightValue,
          smartColumnType(smartSort.key),
        );
        return result * directionFactor || left.index - right.index;
      });
    }
    const nextViewRows = [...filtered, ...ghostEntries];
    if (activeSmartFilterKeys.length || sorted) {
      logDevelopmentPerformance(
        `Smart table view ${nextViewRows.length} rows`,
        startedAt,
      );
    }
    return nextViewRows;
  }, [rows, smartFilters, smartSort, activeSmartFilterKeys.length]);
  smartViewRowsRef.current = smartViewRows;

  function currentSmartViewRowList() {
    return smartViewRowsRef.current.map((entry) => entry.row);
  }

  function smartViewEntryForIndex(visualIndex) {
    return smartViewRowsRef.current[visualIndex] || null;
  }

  function smartActualIndexForPoint(point) {
    if (!point) return -1;
    return rowsRef.current.findIndex(
      (row) => String(row?._gridId || "") === String(point.rowId || ""),
    );
  }

  function smartCellPointFromViewIndex(visualIndex, key) {
    const entry = smartViewEntryForIndex(visualIndex);
    return entry?.row?._gridId && smartCellOrder.includes(key)
      ? { rowId: entry.row._gridId, columnKey: key }
      : null;
  }

  function openSmartColumnMenu(event, column) {
    if (!column || column.key.startsWith("__")) return;
    event.preventDefault();
    event.stopPropagation();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft || 0;
    const viewportTop = visualViewport?.offsetTop || 0;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportHeight = visualViewport?.height || window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const openerRect = event.currentTarget?.getBoundingClientRect?.();
    const menuWidth = Math.min(380, Math.max(320, viewportWidth - 16));
    const availableBelow = openerRect
      ? viewportBottom - openerRect.bottom - 12
      : viewportHeight - event.clientY - 12;
    const availableAbove = openerRect
      ? openerRect.top - viewportTop - 12
      : event.clientY - viewportTop - 12;
    const openAbove = availableBelow < 300 && availableAbove > availableBelow;
    const maxHeight = Math.max(
      180,
      Math.min(
        560,
        viewportHeight - 16,
        Math.max(openAbove ? availableAbove : availableBelow, 260),
      ),
    );
    const preferredLeft = openerRect
      ? openerRect.right - menuWidth
      : event.clientX - menuWidth + 18;
    const preferredTop = openerRect
      ? openAbove
        ? openerRect.top - maxHeight - 6
        : openerRect.bottom + 6
      : event.clientY;
    setCellMenu(null);
    setRowMenu(null);
    setColumnFilterQuery("");
    setColumnMenu({
      key: column.key,
      left: Math.max(
        viewportLeft + 8,
        Math.min(preferredLeft, viewportRight - menuWidth - 8),
      ),
      top: Math.max(
        viewportTop + 8,
        Math.min(preferredTop, viewportBottom - maxHeight - 8),
      ),
      maxHeight,
    });
  }

  function applySmartColumnSort(columnKey, direction) {
    setSmartSort({ key: columnKey, direction });
  }

  function clearSmartColumnSort(columnKey) {
    setSmartSort((current) =>
      current?.key === columnKey ? null : current,
    );
  }

  function setSmartColumnFilter(columnKey, selectedValues) {
    const allValues = smartFilterOptionValues(columnKey);
    setSmartFilters((current) => {
      const next = { ...current };
      if (
        selectedValues.length === allValues.length &&
        selectedValues.every((value) => allValues.includes(value))
      ) {
        delete next[columnKey];
      } else {
        next[columnKey] = selectedValues;
      }
      return next;
    });
  }

  function toggleSmartColumnFilterValue(columnKey, value) {
    const allValues = smartFilterOptionValues(columnKey);
    const currentValues = Array.isArray(smartFiltersRef.current[columnKey])
      ? smartFiltersRef.current[columnKey]
      : allValues;
    const selected = new Set(currentValues);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    setSmartColumnFilter(columnKey, [...selected]);
  }

  function selectAllSmartColumnFilter(columnKey) {
    setSmartColumnFilter(columnKey, smartFilterOptionValues(columnKey));
  }

  function clearSmartColumnFilter(columnKey) {
    setSmartFilters((current) => {
      const next = { ...current };
      delete next[columnKey];
      return next;
    });
  }

  function resetSmartTableView() {
    setSmartSort(null);
    setSmartFilters({});
    setColumnMenu(null);
    setColumnFilterQuery("");
  }

  const columnMenuColumn = columnMenu
    ? smartDisplayColumns.find((column) => column.key === columnMenu.key)
    : null;
  const columnMenuOptions = columnMenuColumn
    ? smartFilterOptionValues(columnMenuColumn.key)
    : [];
  const columnMenuSelectedValues = columnMenuColumn
    ? Array.isArray(smartFilters[columnMenuColumn.key])
      ? smartFilters[columnMenuColumn.key]
      : columnMenuOptions
    : [];
  const columnMenuSelectedSet = new Set(columnMenuSelectedValues);
  const shownColumnMenuOptions = columnMenuOptions.filter((value) =>
    value &&
    normalizeArabic(smartFilterValueLabel(value)).includes(
      normalizeArabic(columnFilterQuery),
    ),
  );
  const columnMenuHasBlankValue = columnMenuOptions.includes("");

  useEffect(() => {
    if (!searchOpen || !String(searchQuery || "").trim()) {
      setSearchResults([]);
      setCurrentSearchResultIndex(0);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const startedAt = performanceStart();
      const searchableRows = currentSmartViewRowList().map((row) => {
        const searchable = { _gridId: row._gridId };
        for (const columnKey of smartCellOrder) {
          searchable[columnKey] = visibleSmartCellValue(row, columnKey);
        }
        return searchable;
      });
      const nextResults = findSmartTableMatches({
        rows: searchableRows,
        columnOrder: smartCellOrder,
        searchText: searchQuery,
      });
      if (cancelled) return;
      const currentResult =
        searchResultsRef.current[currentSearchResultIndexRef.current];
      const preservedIndex = currentResult
        ? nextResults.findIndex(
            (result) =>
              result.rowId === currentResult.rowId &&
              result.columnKey === currentResult.columnKey,
          )
        : -1;
      setSearchResults(nextResults);
      setCurrentSearchResultIndex(
        preservedIndex >= 0
          ? preservedIndex
          : Math.min(
              currentSearchResultIndexRef.current,
              Math.max(0, nextResults.length - 1),
            ),
      );
      logDevelopmentPerformance(
        `Search ${rows.length} rows`,
        startedAt,
        `${nextResults.length} matches`,
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    entryForm.document_type,
    rows,
    searchOpen,
    searchQuery,
    smartFilters,
    smartSort,
  ]);

  function closeSmartTableSearch() {
    setSearchOpen(false);
    window.requestAnimationFrame(() => {
      const focus = rangeSelectionRef.current?.focusCell;
      if (focus) focusSmartCellPoint(focus);
    });
  }

  function jumpToSmartSearchResult(result, resultIndex) {
    if (!result) return;
    const latestIndex = rowsRef.current.findIndex(
      (row) => row._gridId === result.rowId,
    );
    if (latestIndex < 0 || !smartCellOrder.includes(result.columnKey)) return;
    window.clearTimeout(suggestionTimerRef.current);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    setCellMenu(null);
    setRowMenu(null);
    const selection = selectionForCells(
      latestIndex,
      result.columnKey,
      latestIndex,
      result.columnKey,
    );
    updateSmartSelection(selection);
    currentSearchResultIndexRef.current = resultIndex;
    setCurrentSearchResultIndex(resultIndex);
    focusSmartCellPoint(selection?.focusCell);
  }

  function navigateSmartSearchResults(direction) {
    if (!searchResults.length) return;
    const nextIndex =
      (currentSearchResultIndexRef.current + direction + searchResults.length) %
      searchResults.length;
    jumpToSmartSearchResult(searchResults[nextIndex], nextIndex);
  }

  function resolvedDropdownReplacement(columnKey, nextVisibleValue) {
    if (columnKey === "unit_code") {
      const normalized = normalizeArabic(nextVisibleValue);
      return UNITS.find(
        (unit) =>
          normalizeArabic(unit.label) === normalized ||
          normalizeArabic(unit.value) === normalized,
      )?.value;
    }
    if (columnKey === "measurement_mode") {
      const normalized = normalizeArabic(nextVisibleValue);
      if (["قياسي", "standard"].some((value) => normalizeArabic(value) === normalized))
        return "standard";
      if (["هندسي", "engineering"].some((value) => normalizeArabic(value) === normalized))
        return "engineering";
    }
    return undefined;
  }

  async function replaceAllSmartSearch(query, replacement) {
    const searchableRows = rowsRef.current.map((row) => {
      const searchable = { _gridId: row._gridId };
      for (const columnKey of smartCellOrder) {
        searchable[columnKey] = visibleSmartCellValue(row, columnKey);
      }
      return searchable;
    });
    const latestMatches = findSmartTableMatches({
      rows: searchableRows,
      columnOrder: smartCellOrder,
      searchText: query,
    });
    if (!latestMatches.length) {
      setMessage("لا توجد نتائج قابلة للاستبدال.");
      return;
    }
    const matchKeys = new Set(
      latestMatches.map((match) => `${match.rowId}:${match.columnKey}`),
    );
    const patches = new Map();
    let changedCells = 0;
    let replacedOccurrences = 0;
    for (const row of rowsRef.current) {
      const patch = {};
      for (const columnKey of smartCellOrder) {
        if (!matchKeys.has(`${row._gridId}:${columnKey}`)) continue;
        const visibleValue = visibleSmartCellValue(row, columnKey);
        const replaced = replaceSmartSearchMatches(
          visibleValue,
          query,
          replacement,
        );
        if (!replaced.replacements) continue;
        let nextValue = replaced.value;
        if (["unit_code", "measurement_mode"].includes(columnKey)) {
          const resolved = resolvedDropdownReplacement(columnKey, nextValue);
          if (resolved === undefined) continue;
          nextValue = resolved;
        } else if (SMART_NUMERIC_CLIPBOARD_KEYS.has(columnKey)) {
          const normalized = normalizeSmartNumericClipboardValue(nextValue);
          if (
            normalized &&
            !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)
          ) {
            continue;
          }
          nextValue = normalized;
        }
        if (String(row[columnKey] ?? "") === String(nextValue ?? "")) continue;
        patch[columnKey] = nextValue;
        changedCells += 1;
        replacedOccurrences += replaced.replacements;
      }
      if (Object.keys(patch).length) patches.set(row._gridId, patch);
    }
    if (!changedCells) {
      setMessage("لا توجد نتائج قابلة للاستبدال.");
      return;
    }
    if (
      changedCells > 1 &&
      !(await askForConfirmation({
        title: "استبدال الكل",
        message: `سيتم استبدال النص في ${changedCells} خلية.`,
        confirmLabel: "استبدال الكل",
      }))
    ) {
      return;
    }
    const startedAt = performanceStart();
    recordSmartHistory();
    const nextRows = normalizeSmartRows(
      rowsRef.current.map((row) => {
        const patch = patches.get(row._gridId);
        if (!patch) return row;
        return {
          ...row,
          ...patch,
          _gridGhost: false,
          _manualBlank: false,
          _touched: {
            ...(row._touched || {}),
            ...touchedPatch(Object.keys(patch)),
          },
        };
      }),
    );
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    setPreviewData(null);
    setEntryDirty?.(true);
    setMessage(
      `تم الاستبدال في ${changedCells} خلية (${replacedOccurrences} تطابق).`,
    );
    logDevelopmentPerformance(
      `Replace all ${changedCells} cells`,
      startedAt,
    );
  }

  function smartCellPoint(index, key, list = rowsRef.current) {
    const row = list[index];
    if (!row?._gridId || !smartCellOrder.includes(key)) return null;
    return { rowId: row._gridId, columnKey: key };
  }

  function smartCellIndexes(point, list = currentSmartViewRowList()) {
    if (!point) return null;
    const lookup = list === rowsRef.current ? list : list || currentSmartViewRowList();
    const rowIndex = lookup.findIndex(
      (row) => String(row?._gridId || "") === String(point.rowId || ""),
    );
    const columnIndex = smartCellOrder.indexOf(point.columnKey);
    return rowIndex >= 0 && columnIndex >= 0
      ? { rowIndex, columnIndex }
      : null;
  }

  function updateSmartSelection(next) {
    const resolved =
      typeof next === "function" ? next(rangeSelectionRef.current) : next;
    rangeSelectionRef.current = resolved || null;
    setRangeSelection(resolved || null);
  }

  function updateSmartEditingCell(next) {
    const previous = editingCellRef.current;
    const resolved =
      typeof next === "function" ? next(editingCellRef.current) : next;
    if ((resolved || "") !== previous) {
      const nextSession = activeEditSessionRef.current + 1;
      activeEditSessionRef.current = nextSession;
      editingSessionCellRef.current = resolved || "";
      setActiveEditSession(nextSession);
    }
    editingCellRef.current = resolved || "";
    setEditingCell(resolved || "");
  }

  function updateSmartActiveCell(next) {
    const resolved =
      typeof next === "function" ? next(activeCellRef.current) : next;
    activeCellRef.current = resolved || "";
    setActiveCell(resolved || "");
  }

  function updateSmartSuggestionIndex(next) {
    const resolved =
      typeof next === "function"
        ? next(activeSuggestionIndexRef.current)
        : next;
    const numeric = Number(resolved);
    activeSuggestionIndexRef.current = Number.isFinite(numeric) ? numeric : -1;
    setActiveSuggestionIndex(activeSuggestionIndexRef.current);
  }

  function selectionForCells(
    anchorRow,
    anchorKey,
    focusRow = anchorRow,
    focusKey = anchorKey,
  ) {
    const anchorCell = smartCellPoint(anchorRow, anchorKey);
    const focusCell = smartCellPoint(focusRow, focusKey);
    return anchorCell && focusCell ? { anchorCell, focusCell } : null;
  }

  copyShortcutHandlerRef.current = (event) => {
      const active = document.activeElement;
      if (!active?.closest?.(".smart-entry-table")) return;
      if (hasSelectedTextInsideEditor(event.target || active)) return;
      const textValue = selectedRangeText();
      if (!textValue) return;
      rememberSmartClipboard(textValue);
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData?.setData("text/plain", textValue);
  };

  pasteShortcutHandlerRef.current = (event) => {
      if (editingCell) return;
      const active = document.activeElement;
      const activeTable = active?.closest?.(".smart-entry-table");
      if (isEditableFocusTarget(active) && !activeTable) return;
      const range = normalizedRange();
      if (!range) return;
      const textValue =
        event.clipboardData?.getData("text/plain") ||
        smartClipboardRef.current.text ||
        "";
      if (!textValue) return;
      const startEntry = smartViewRowsRef.current[range.rowStart];
      if (!startEntry) return;
      event.preventDefault();
      event.stopPropagation();
      pasteSmartClipboardText(
        textValue,
        startEntry.index,
        smartCellOrder[range.colStart],
        { destinationRange: range },
      );
      setCellMenu(null);
      setRowMenu(null);
  };

  useEffect(() => {
    const copySmartRange = (event) =>
      copyShortcutHandlerRef.current?.(event);
    const pasteIntoSelectedRange = (event) =>
      pasteShortcutHandlerRef.current?.(event);
    document.addEventListener("copy", copySmartRange);
    document.addEventListener("paste", pasteIntoSelectedRange);
    return () => {
      document.removeEventListener("copy", copySmartRange);
      document.removeEventListener("paste", pasteIntoSelectedRange);
    };
  }, []);

  useEffect(() => {
    if (!rowMenu && !cellMenu && !columnMenu) return undefined;
    const close = (event) => {
      const target = event?.target;
      if (
        target?.closest?.(
          ".smart-row-context-menu, .smart-cell-context-menu, .smart-column-menu, .smart-column-menu-button",
        )
      ) {
        return;
      }
      setCellMenu(null);
      setRowMenu(null);
      setColumnMenu(null);
    };
    const closeOnViewportChange = () => {
      setCellMenu(null);
      setRowMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setCellMenu(null);
        setRowMenu(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [cellMenu, rowMenu, columnMenu]);

  useEffect(() => {
    let cancelled = false;
    async function loadCertificateNumber() {
      if (
        entryForm.document_type !== "contractor_certificate" ||
        !entryForm.party_id ||
        !entryForm.project
      ) {
        setCertificateInfo(null);
        return;
      }
      try {
        const query = new URLSearchParams({
          party_id: String(entryForm.party_id),
          project: entryForm.project,
        });
        const data = await api.request(`/api/next-certificate-no?${query.toString()}`);
        if (cancelled) return;
        setCertificateInfo(data);
        if (!isDocumentEdit && !entryForm.certificate_no) {
          setEntryForm((current) => ({
            ...current,
            certificate_no: String(data.next_no),
          }));
        }
      } catch {
        if (!cancelled) setCertificateInfo(null);
      }
    }
    loadCertificateNumber();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    entryForm.document_type,
    entryForm.party_id,
    entryForm.project,
    entryForm.certificate_no,
    isDocumentEdit,
    setEntryForm,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadExistingRows() {
      const docId = editorContext?.document?.id || entryForm.document_id;
      if (!docId) return;
      let existingRows = editorContext?.reportData?.rows || [];
      if (!existingRows.length) {
        try {
          const reportType =
            entryForm.document_type === "invoice"
              ? "invoice"
              : entryForm.document_type === "contractor_certificate"
                ? "contractor"
                : "offer";
          const params = new URLSearchParams({
            document_id: String(docId),
            dimension_unit: "cm",
            subtotal_mode: "none",
          });
          const data = await api.request(
            `/api/documents/${reportType}?${params.toString()}`,
          );
          existingRows = data.rows || [];
        } catch (error) {
          if (!cancelled)
            setMessage(`تعذر تحميل بنود المستند: ${error.message}`);
        }
      }
      if (cancelled || !existingRows.length) return;
      const loadedRows = existingRows.map(smartRowFromExisting);
      setRows([...loadedRows, smartRowFrom()]);
      updateSmartSelection(null);
      setDeletedRowIds([]);
      setPreviewData(null);
      setEntryDirty?.(false);
    }
    loadExistingRows();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    editorContext?.document?.id,
    editorContext?.reportData,
    entryForm.document_id,
    entryForm.document_type,
    setEntryDirty,
    setMessage,
  ]);

  function cloneSmartRows(list = []) {
    return list.map((row) => ({
      ...row,
      _touched: { ...(row._touched || {}) },
    }));
  }

  function smartSnapshot(
    snapshotRows = rowsRef.current,
    snapshotSelection = rangeSelectionRef.current,
  ) {
    return {
      rows: cloneSmartRows(snapshotRows),
      deletedRowIds: [...deletedRowIdsRef.current],
      rowHeight: rowHeightRef.current,
      selection: snapshotSelection
        ? {
            anchorCell: { ...snapshotSelection.anchorCell },
            focusCell: { ...snapshotSelection.focusCell },
          }
        : null,
    };
  }

  function recordSmartHistory(snapshotRows = rowsRef.current) {
    const snapshot = smartSnapshot(snapshotRows);
    const nextUndo = [...undoStackRef.current.slice(-59), snapshot];
    undoStackRef.current = nextUndo;
    redoStackRef.current = [];
    setUndoStack(nextUndo);
    setRedoStack([]);
  }

  function applySmartSnapshot(snapshot) {
    if (!snapshot) return;
    const nextRows = cloneSmartRows(snapshot.rows || [smartRowFrom()]);
    const nextDeletedRowIds = [...(snapshot.deletedRowIds || [])];
    rowsRef.current = nextRows;
    deletedRowIdsRef.current = nextDeletedRowIds;
    markGridMutation();
    setRows(nextRows);
    setDeletedRowIds(nextDeletedRowIds);
    setRowHeight(snapshot.rowHeight || 52);
    updateSmartSelection(snapshot.selection || null);
    if (snapshot.selection?.focusCell) {
      focusSmartCellPoint(snapshot.selection.focusCell);
    }
    setPreviewData(null);
    setEntryDirty?.(true);
    restoreInputInteractivity();
  }

  function undoSmartTable() {
    const stack = undoStackRef.current;
    if (!stack.length) return;
    const current = smartSnapshot();
    const previous = stack[stack.length - 1];
    const nextUndo = stack.slice(0, -1);
    const nextRedo = [...redoStackRef.current.slice(-59), current];
    undoStackRef.current = nextUndo;
    redoStackRef.current = nextRedo;
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    applySmartSnapshot(previous);
  }

  function redoSmartTable() {
    const stack = redoStackRef.current;
    if (!stack.length) return;
    const current = smartSnapshot();
    const next = stack[stack.length - 1];
    const nextRedo = stack.slice(0, -1);
    const nextUndo = [...undoStackRef.current.slice(-59), current];
    redoStackRef.current = nextRedo;
    undoStackRef.current = nextUndo;
    setRedoStack(nextRedo);
    setUndoStack(nextUndo);
    applySmartSnapshot(next);
  }

  function normalizeSmartRows(nextRows) {
    const normalized = cloneSmartRows(nextRows).map((row) => ({
      ...row,
      _gridId: row._gridId || nextSmartGridRowId(row._existingId || ""),
      _gridGhost: !(
        rowHasData(row) ||
        row._existingId ||
        row._manualBlank ||
        hasExplicitSmartValue(row)
      ),
    }));
    const activeOrPersisted = normalized.filter(
      (row) =>
        rowHasData(row) ||
        row._existingId ||
        row._manualBlank ||
        hasExplicitSmartValue(row),
    );
    const reusableGhost = normalized.find(
      (row) =>
        !rowHasData(row) &&
        !row._existingId &&
        !row._manualBlank &&
        !hasExplicitSmartValue(row),
    );
    activeOrPersisted.push(
      reusableGhost
        ? { ...reusableGhost, _gridGhost: true }
        : smartRowFrom(),
    );
    return activeOrPersisted;
  }

  function lastActiveRowIndex(list = rowsRef.current) {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (rowHasData(list[index])) return index;
    }
    return -1;
  }

  function touchedPatch(keys) {
    return keys.reduce((acc, key) => ({ ...acc, [key]: true }), {});
  }

  function markGridMutation() {
    gridRevisionRef.current += 1;
    return gridRevisionRef.current;
  }

  function updateFixed(patch) {
    setPreviewData(null);
    setEntryDirty?.(true);
    setEntryForm((current) => ({ ...current, ...patch }));
    const rowFieldKeys = ["work_type", "building_unit", "floor_apartment"];
    const changedRowKeys = rowFieldKeys.filter((key) =>
      Object.prototype.hasOwnProperty.call(patch, key),
    );
    if (changedRowKeys.length) {
      const nextRows = rowsRef.current.map((row) => {
        if (!rowHasData(row)) return row;
        const rowPatch = {};
        for (const key of changedRowKeys) rowPatch[key] = patch[key];
        return {
          ...row,
          ...rowPatch,
          _touched: {
            ...(row._touched || {}),
            ...touchedPatch(changedRowKeys),
          },
        };
      });
      rowsRef.current = nextRows;
      markGridMutation();
      setRows(nextRows);
    }
  }

  function changeDocumentType(value) {
    const nextMeta = documentTypeMeta(value);
    const resetIdentity = isDocumentEdit
      ? {}
      : { document_id: "", operation_no: "", serial: "" };
    updateFixed({
      ...resetIdentity,
      document_type: value,
      document_status: nextMeta.status,
      party_role: nextMeta.role,
      certificate_no: "",
      work_type: "",
      work_types: [],
      ...(value === "price_offer" ? {} : { vat_terms_only: false }),
      ...(value === "contractor_certificate"
        ? {}
        : { source_customer_id: "", source_customer_name: "" }),
    });
    if (!isDocumentEdit) {
      recordSmartHistory();
      const nextRows = [smartRowFrom()];
      rowsRef.current = nextRows;
      markGridMutation();
      setRows(nextRows);
      updateSmartSelection(null);
    }
  }

  function defaultsForDescription(value, currentRows, currentIndex) {
    const needle = normalizeArabic(value);
    if (!needle) return null;
    const previousRows = currentRows.slice(0, currentIndex).reverse();
    const candidates = [...previousRows, ...suggestionRows];
    return candidates.find((row) => normalizeArabic(row.description) === needle) || null;
  }

  function updateRow(index, key, value) {
    if (String(rowsRef.current[index]?.[key] || "") === String(value || ""))
      return;
    const startedAt = performanceStart();
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const current = rowsRef.current;
    const copyKeys = [
      "building_unit",
      "floor_apartment",
      "glass_spec",
      "profile_spec",
      "color",
      "rate",
      "completion_ratio",
      "unit_code",
      "measurement_mode",
    ];
    const next = current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const patch = {
        [key]: value,
        _gridGhost: false,
        _manualBlank: false,
        _touched: { ...(row._touched || {}), [key]: true },
      };
      if (key === "description") {
        const defaults = defaultsForDescription(value, current, index);
        if (defaults) {
          for (const copyKey of copyKeys) {
            if (!row[copyKey] && defaults[copyKey]) {
              patch[copyKey] = defaults[copyKey];
              patch._touched[copyKey] = true;
            }
          }
        }
      }
      return { ...row, ...patch };
    });
    if (index === next.length - 1 && rowHasData(next[index])) {
      next.push(smartRowFrom());
    }
    rowsRef.current = next;
    markGridMutation();
    setRows(next);
    logDevelopmentPerformance("Cell commit", startedAt);
  }

  function normalizedRange(selection = rangeSelectionRef.current) {
    if (!selection?.anchorCell || !selection?.focusCell) return null;
    const anchor = smartCellIndexes(selection.anchorCell);
    const focus = smartCellIndexes(selection.focusCell);
    if (!anchor || !focus) return null;
    return {
      rowStart: Math.min(anchor.rowIndex, focus.rowIndex),
      rowEnd: Math.max(anchor.rowIndex, focus.rowIndex),
      colStart: Math.min(anchor.columnIndex, focus.columnIndex),
      colEnd: Math.max(anchor.columnIndex, focus.columnIndex),
    };
  }

  function isCellSelected(index, key) {
    const range = normalizedRange();
    if (!range) return false;
    const point = smartCellPoint(index, key);
    const indexes = smartCellIndexes(point);
    if (!indexes) return false;
    const column = indexes.columnIndex;
    return (
      indexes.rowIndex >= range.rowStart &&
      indexes.rowIndex <= range.rowEnd &&
      column >= range.colStart &&
      column <= range.colEnd
    );
  }

  function selectedRangeText() {
    const range = normalizedRange();
    if (!range) return "";
    const lines = [];
    const viewRows = currentSmartViewRowList();
    for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
      const row = viewRows[rowIndex];
      if (!row) continue;
      const values = [];
      for (let colIndex = range.colStart; colIndex <= range.colEnd; colIndex += 1) {
        values.push(row?.[smartCellOrder[colIndex]] ?? "");
      }
      lines.push(values.join("\t"));
    }
    return lines.join("\n");
  }

  function rememberSmartClipboard(textValue) {
    const text = String(textValue || "");
    if (!text) return;
    smartClipboardRef.current = {
      text,
      grid: parseSmartClipboardGrid(text),
    };
  }

  function pasteSmartClipboardText(
    textValue,
    index,
    key,
    { destinationRange = null } = {},
  ) {
    const parseStartedAt = performanceStart();
    const grid = parseSmartClipboardGrid(textValue);
    logDevelopmentPerformance(
      "Clipboard parse",
      parseStartedAt,
      `${grid.length} rows`,
    );
    if (!grid.length) return false;
    return applySmartGrid(index, key, grid, { destinationRange });
  }

  function applySmartGrid(index, key, grid, { destinationRange = null } = {}) {
    const startedAt = performanceStart();
    const appliedGrid = expandSmartClipboardGrid(grid, destinationRange);
    if (!appliedGrid.length || !appliedGrid[0]?.length) return false;
    const startColumn = smartCellOrder.indexOf(key);
    if (startColumn < 0) return false;
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const result = applySmartClipboardGridToRows({
      rows: rowsRef.current,
      startRow: index,
      startKey: key,
      columnOrder: smartCellOrder,
      grid: appliedGrid,
      createRow: smartRowFrom,
      normalizeValue: normalizeSmartClipboardValue,
    });
    if (!result) return false;
    const normalized = normalizeSmartRows(result.rows);
    rowsRef.current = normalized;
    markGridMutation();
    setRows(normalized);
    const endColumn = Math.min(
      smartCellOrder.length - 1,
      startColumn + Math.max(...appliedGrid.map((line) => line.length)) - 1,
    );
    updateSmartSelection(
      selectionForCells(
        index,
        key,
        index + appliedGrid.length - 1,
        smartCellOrder[endColumn] || key,
      ),
    );
    setCellMenu(null);
    setRowMenu(null);
    logDevelopmentPerformance(
      `Paste ${appliedGrid.length} rows locally`,
      startedAt,
    );
    return true;
  }

  function openSmartCellMenu(event, index, key) {
    if (hasSelectedTextInsideEditor(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const row = rowsRef.current[index];
    if (!row?._gridId || !smartCellOrder.includes(key)) return;
    if (
      editingCellRef.current &&
      hasUncommittedSmartCellDraft(editingCellRef.current)
    ) {
      const separator = editingCellRef.current.indexOf(":");
      commitSmartCellEdit(
        Number(editingCellRef.current.slice(0, separator)),
        editingCellRef.current.slice(separator + 1),
      );
    }
    window.clearTimeout(suggestionTimerRef.current);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    if (!isCellSelected(index, key)) {
      updateSmartSelection(selectionForCells(index, key));
    }
    const menuWidth = 188;
    const menuHeight = 138;
    setRowMenu(null);
    setCellMenu({
      rowId: row._gridId,
      key,
      left: Math.max(
        8,
        Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      ),
      top: Math.max(
        8,
        Math.min(event.clientY, window.innerHeight - menuHeight - 8),
      ),
    });
  }

  function cellMenuTargetRange() {
    if (!cellMenu) return null;
    const index = rowsRef.current.findIndex(
      (row) => row._gridId === cellMenu.rowId,
    );
    const columnIndex = smartCellOrder.indexOf(cellMenu.key);
    if (index < 0 || columnIndex < 0) return null;
    const selected = normalizedRange();
    const cellPoint = smartCellPoint(index, cellMenu.key);
    const cellViewIndexes = smartCellIndexes(cellPoint);
    if (
      selected &&
      cellViewIndexes &&
      cellViewIndexes.rowIndex >= selected.rowStart &&
      cellViewIndexes.rowIndex <= selected.rowEnd &&
      columnIndex >= selected.colStart &&
      columnIndex <= selected.colEnd
    ) {
      return selected;
    }
    return {
      rowStart: cellViewIndexes?.rowIndex ?? index,
      rowEnd: cellViewIndexes?.rowIndex ?? index,
      colStart: columnIndex,
      colEnd: columnIndex,
    };
  }

  async function copySmartCellMenuContent() {
    const range = cellMenuTargetRange();
    if (!range) {
      setCellMenu(null);
      return;
    }
    const previousSelection = rangeSelectionRef.current;
    updateSmartSelection(
      selectionForCells(
        range.rowStart,
        smartCellOrder[range.colStart],
        range.rowEnd,
        smartCellOrder[range.colEnd],
      ),
    );
    const textValue = selectedRangeText();
    if (textValue) {
      rememberSmartClipboard(textValue);
      await copyTextToClipboard(textValue);
    }
    if (!previousSelection) updateSmartSelection(null);
    setCellMenu(null);
    restoreInputInteractivity();
  }

  async function pasteSmartCellMenuContent() {
    const range = cellMenuTargetRange();
    if (!range) {
      setCellMenu(null);
      return;
    }
    try {
      const systemText = navigator.clipboard?.readText
        ? await navigator.clipboard.readText().catch(() => "")
        : "";
      const textValue = systemText || smartClipboardRef.current.text || "";
      if (!textValue) {
        setMessage("الحافظة فارغة.");
        return;
      }
      pasteSmartClipboardText(
        textValue,
        range.rowStart,
        smartCellOrder[range.colStart],
        { destinationRange: range },
      );
    } catch {
      setMessage("تعذر قراءة الحافظة. استخدم Ctrl+V بعد تحديد الخلية.");
    } finally {
      setCellMenu(null);
      restoreInputInteractivity();
    }
  }

  function clearSmartCellMenuContent() {
    const range = cellMenuTargetRange();
    if (!range) {
      setCellMenu(null);
      return;
    }
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const viewRows = currentSmartViewRowList();
    const selectedRowIds = new Set();
    for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
      const row = viewRows[rowIndex];
      if (row?._gridId) selectedRowIds.add(row._gridId);
    }
    const nextRows = rowsRef.current.map((row, rowIndex) => {
      if (!selectedRowIds.has(row._gridId)) return row;
      const patch = {};
      const touched = { ...(row._touched || {}) };
      for (
        let columnIndex = range.colStart;
        columnIndex <= range.colEnd;
        columnIndex += 1
      ) {
        const columnKey = smartCellOrder[columnIndex];
        patch[columnKey] = "";
        touched[columnKey] = true;
      }
      const nextRow = {
        ...row,
        ...patch,
        _gridGhost: false,
        _touched: touched,
      };
      return {
        ...nextRow,
        _manualBlank: !rowHasData(nextRow),
      };
    });
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    setCellMenu(null);
    restoreInputInteractivity();
  }

  function openSmartRowMenu(event, row) {
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(suggestionTimerRef.current);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    const latestIndex = rowsRef.current.findIndex(
      (candidate) => candidate._gridId === row._gridId,
    );
    if (latestIndex >= 0) {
      updateSmartSelection(
        selectionForCells(
          latestIndex,
          smartCellOrder[0],
          latestIndex,
          smartCellOrder[smartCellOrder.length - 1],
        ),
      );
    }
    const menuWidth = 248;
    const menuHeight = 146;
    setCellMenu(null);
    setRowMenu({
      rowId: row._gridId,
      left: Math.max(
        8,
        Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      ),
      top: Math.max(
        8,
        Math.min(event.clientY, window.innerHeight - menuHeight - 8),
      ),
    });
  }

  function insertEmptySmartRow(targetRowId, placement) {
    const insertion = insertSmartRowRelative({
      rows: rowsRef.current,
      targetRowId,
      placement,
      createRow: manualBlankSmartRow,
    });
    if (!insertion) {
      setRowMenu(null);
      return;
    }
    const startedAt = performanceStart();
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const insertedRow = insertion.row;
    const nextRows = normalizeSmartRows(insertion.rows);
    const normalizedInsertIndex = nextRows.findIndex(
      (row) => row._gridId === insertedRow._gridId,
    );
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    const nextSelection = selectionForCells(
      normalizedInsertIndex,
      smartCellOrder[0],
      normalizedInsertIndex,
      smartCellOrder[0],
    );
    updateSmartSelection(nextSelection);
    setRowMenu(null);
    focusSmartCellPoint(nextSelection.focusCell);
    logDevelopmentPerformance("Insert empty row", startedAt);
  }

  async function pasteIntoCurrentSmartSelection() {
    try {
      const systemText = navigator.clipboard?.readText
        ? await navigator.clipboard.readText().catch(() => "")
        : "";
      const textValue = systemText || smartClipboardRef.current.text || "";
      if (!textValue) {
        setMessage("الحافظة فارغة.");
        return;
      }
      const range = normalizedRange();
      if (!range) {
        setMessage("حدد خلية أولاً للصق البيانات.");
        return;
      }
      pasteSmartClipboardText(
        textValue,
        range.rowStart,
        smartCellOrder[range.colStart],
        { destinationRange: range },
      );
    } catch {
      setMessage("تعذر قراءة الحافظة. استخدم Ctrl+V بعد تحديد الخلية.");
    } finally {
      restoreInputInteractivity();
    }
  }

  async function deleteSmartRowFromMenu() {
    const targetRowId = rowMenu?.rowId;
    setRowMenu(null);
    if (!targetRowId) return;
    await deleteSmartRowById(targetRowId, { ignoreSelection: true });
  }

  function handleSmartPaste(event, index, key) {
    const textValue = event.clipboardData?.getData("text/plain") || "";
    if (!textValue.includes("\t") && !textValue.includes("\n")) return;
    event.preventDefault();
    event.stopPropagation();
    pasteSmartClipboardText(textValue, index, key);
    restoreInputInteractivity(event.currentTarget);
  }

  const specCopyKeys = [
    "work_type",
    "building_unit",
    "floor_apartment",
    "description",
    "glass_spec",
    "profile_spec",
    "color",
    "unit_code",
    "rate",
    "completion_ratio",
    "measurement_mode",
  ];
  const fieldCopyDownKeys = new Set(smartCellOrder);

  async function copyRowSpecDown(index) {
    dismissSmartCellUi();
    const source = rowsRef.current[index];
    const lastIndex = lastActiveRowIndex();
    if (!source || index >= lastIndex) {
      setMessage("لا توجد صفوف نشطة أسفل هذا الصف للنسخ إليها.");
      restoreInputInteractivity();
      return;
    }
    if (!(await askForConfirmation({
      title: "نسخ مواصفات الصف للأسفل",
      message:
        "سيتم نسخ بيانات هذا الصف إلى الصفوف التالية مع الحفاظ على المقاسات والكميات.",
      confirmLabel: "نسخ للأسفل",
    }))) {
      restoreInputInteractivity();
      return;
    }
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const nextRows = rowsRef.current.map((row, rowIndex) => {
      if (rowIndex <= index || rowIndex > lastIndex || !rowHasData(row))
        return row;
      const patch = {};
      for (const key of specCopyKeys) {
        if (!smartCellOrder.includes(key)) continue;
        patch[key] = source[key] ?? "";
      }
      return {
        ...row,
        ...patch,
        _touched: {
          ...(row._touched || {}),
          ...touchedPatch(Object.keys(patch)),
        },
      };
    });
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    restoreInputInteractivity();
  }

  async function copyFullRowToBottom(index) {
    dismissSmartCellUi();
    const source = rowsRef.current[index];
    if (!source || !rowHasData(source)) {
      setMessage("اختر صفاً يحتوي على بيانات أولاً.");
      restoreInputInteractivity();
      return;
    }
    if (!(await askForConfirmation({
      title: "نسخ الصف بالكامل",
      message: "سيتم نسخ الصف بالكامل إلى صف جديد في نهاية الجدول.",
      confirmLabel: "نسخ الصف",
    }))) {
      restoreInputInteractivity();
      return;
    }
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const cleanSource = { ...source };
    delete cleanSource._existingId;
    delete cleanSource._gridId;
    delete cleanSource._originalBuildingUnit;
    delete cleanSource._originalFloorApartment;
    const copied = {
      ...cleanSource,
      _gridId: nextSmartGridRowId(),
      _gridGhost: false,
      _manualBlank: false,
      _touched: touchedPatch(smartCellOrder),
    };
    const withoutTrailingGhost =
      rowsRef.current.length &&
      rowsRef.current.at(-1)?._gridGhost &&
      !rowHasData(rowsRef.current.at(-1))
        ? rowsRef.current.slice(0, -1)
        : rowsRef.current;
    const nextRows = [
      ...cloneSmartRows(withoutTrailingGhost),
      copied,
      smartRowFrom(),
    ];
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    restoreInputInteractivity();
  }

  async function copyFieldDown(index, key) {
    dismissSmartCellUi();
    const source = rowsRef.current[index];
    const lastIndex = lastActiveRowIndex();
    if (!source || index >= lastIndex) {
      setMessage("لا توجد صفوف نشطة أسفل هذا الحقل للنسخ إليها.");
      restoreInputInteractivity();
      return;
    }
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const nextRows = rowsRef.current.map((row, rowIndex) => {
      if (rowIndex <= index || rowIndex > lastIndex || !rowHasData(row))
        return row;
      return {
        ...row,
        [key]: source[key] ?? "",
        _touched: { ...(row._touched || {}), [key]: true },
      };
    });
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    restoreInputInteractivity();
  }

  async function applyDragFill(sourceIndex, targetIndex) {
    if (targetIndex <= sourceIndex) return;
    const source = rowsRef.current[sourceIndex];
    if (!source || !rowHasData(source)) return;
    if (!(await askForConfirmation({
      title: "تعبئة الصفوف للأسفل",
      message: `سيتم نسخ الصف ${sourceIndex + 1} إلى الصفوف حتى ${targetIndex + 1}.`,
      confirmLabel: "تعبئة الصفوف",
    }))) {
      restoreInputInteractivity();
      return;
    }
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const next = cloneSmartRows(rowsRef.current);
    while (next.length <= targetIndex) next.push(smartRowFrom());
    for (
      let rowIndex = sourceIndex + 1;
      rowIndex <= targetIndex;
      rowIndex += 1
    ) {
      const targetIdentity = {
        _existingId: next[rowIndex]._existingId,
        _gridId: next[rowIndex]._gridId,
      };
      next[rowIndex] = {
        ...next[rowIndex],
        ...source,
        ...targetIdentity,
        _gridGhost: false,
        _manualBlank: false,
        _touched: touchedPatch(smartCellOrder),
      };
      delete next[rowIndex]._originalBuildingUnit;
      delete next[rowIndex]._originalFloorApartment;
    }
    const normalized = normalizeSmartRows(next);
    rowsRef.current = normalized;
    markGridMutation();
    setRows(normalized);
    restoreInputInteractivity();
  }

  function beginDragFill(index, event) {
    event.preventDefault();
    event.stopPropagation();
    dragFillRef.current = { sourceIndex: index, targetIndex: index };
    setFillPreview({ sourceIndex: index, targetIndex: index });
    const move = (moveEvent) => {
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const rowElement = element?.closest?.("[data-smart-row-index]");
      const rawIndex = rowElement?.getAttribute?.("data-smart-row-index");
      if (rawIndex === undefined || rawIndex === null) return;
      const targetIndex = Math.max(index, Number(rawIndex));
      dragFillRef.current = { sourceIndex: index, targetIndex };
      setFillPreview({ sourceIndex: index, targetIndex });
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      const targetIndex = dragFillRef.current?.targetIndex ?? index;
      dragFillRef.current = null;
      setFillPreview(null);
      applyDragFill(index, targetIndex);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
  }

  function beginRowResize(event) {
    event.preventDefault();
    event.stopPropagation();
    recordSmartHistory();
    const startY = event.clientY;
    const startHeight = rowHeightRef.current;
    const move = (moveEvent) => {
      const nextHeight = Math.min(
        180,
        Math.max(42, startHeight + moveEvent.clientY - startY),
      );
      setRowHeight(nextHeight);
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      restoreInputInteractivity();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
  }

  function beginColumnResize(key, event) {
    event.preventDefault();
    event.stopPropagation();
    const column = smartDisplayColumns.find((item) => item.key === key);
    if (!column) return;
    const startX = event.clientX;
    const startWidth = resolvedColumnWidth(column);
    const move = (moveEvent) => {
      const nextWidth = Math.min(
        520,
        Math.max(key === "__index" ? 48 : 68, startWidth + startX - moveEvent.clientX),
      );
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      restoreInputInteractivity();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
  }

  function positionCellSuggestions(cellKey, target, { resetIndex = false } = {}) {
    updateSmartActiveCell(cellKey);
    if (resetIndex) updateSmartSuggestionIndex(-1);
    if (!target?.getBoundingClientRect) return;
    const rect = target.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft || 0;
    const viewportTop = visualViewport?.offsetTop || 0;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportHeight = visualViewport?.height || window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const width = Math.min(
      Math.max(rect.width, 160),
      Math.max(160, viewportWidth - 16),
    );
    const left = Math.min(
      Math.max(viewportLeft + 8, rect.right - width),
      Math.max(viewportLeft + 8, viewportRight - width - 8),
    );
    const gap = 4;
    const availableBelow = viewportBottom - rect.bottom - gap - 8;
    const availableAbove = rect.top - viewportTop - gap - 8;
    const openUp = availableBelow < 120 && availableAbove > availableBelow;
    const maxHeight = Math.max(
      96,
      Math.min(280, openUp ? availableAbove : availableBelow),
    );
    const top = openUp
      ? Math.max(viewportTop + 8, rect.top - gap - maxHeight)
      : Math.min(rect.bottom + gap, viewportBottom - maxHeight - 8);
    setSuggestionRect({
      top,
      left,
      width,
      maxHeight,
    });
  }

  function openCellSuggestions(cellKey, target) {
    positionCellSuggestions(cellKey, target, { resetIndex: true });
  }

  function openCellSuggestionsFromFocus(cellKey, target) {
    window.clearTimeout(suggestionTimerRef.current);
    const delayUntil = Number(target?.dataset?.suggestionDelayUntil || 0);
    if (delayUntil > Date.now()) {
      suggestionTimerRef.current = window.setTimeout(() => {
        if (document.activeElement === target) {
          delete target.dataset.suggestionDelayUntil;
          openCellSuggestions(cellKey, target);
        }
      }, delayUntil - Date.now());
      return;
    }
    delete target?.dataset?.suggestionDelayUntil;
    openCellSuggestions(cellKey, target);
  }

  function applyCellSuggestion(
    index,
    key,
    value,
    { moveDown = true, sessionId = activeEditSessionRef.current } = {},
  ) {
    const cellKey = `${index}:${key}`;
    if (!isCurrentSmartEditSession(cellKey, sessionId)) return;
    const target = document.querySelector(`[data-smart-cell="${cellKey}"]`);
    const committedValue = String(value ?? "");
    window.clearTimeout(suggestionTimerRef.current);
    cellDraftsRef.current.set(cellKey, committedValue);
    suggestionCommittedCellsRef.current.add(cellKey);
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      target.value = committedValue;
    } else if (target?.isContentEditable) {
      target.innerText = committedValue;
    }
    flushSync(() => {
      updateRow(index, key, committedValue);
    });
    const committedTarget = document.querySelector(`[data-smart-cell="${cellKey}"]`);
    if (
      committedTarget instanceof HTMLInputElement ||
      committedTarget instanceof HTMLTextAreaElement
    ) {
      committedTarget.value = committedValue;
    } else if (committedTarget?.isContentEditable) {
      committedTarget.innerText = committedValue;
    }
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    if (moveDown) {
      moveSmartCellDown(index, key);
    } else {
      updateSmartEditingCell(cellKey);
      updateSmartSelection(selectionForCells(index, key));
      focusCellContainer(index, key);
    }
  }

  function closeCellSuggestions() {
    window.setTimeout(() => {
      updateSmartActiveCell("");
      setSuggestionRect(null);
      updateSmartSuggestionIndex(-1);
    }, 180);
  }

  function dismissSmartCellUi() {
    window.clearTimeout(suggestionTimerRef.current);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
  }

  function smartCellDraftValue(index, key) {
    const cellKey = `${index}:${key}`;
    if (cellDraftsRef.current.has(cellKey)) {
      return cellDraftsRef.current.get(cellKey);
    }
    const editor = document.querySelector(`[data-smart-cell="${cellKey}"]`);
    if (
      editor instanceof HTMLInputElement ||
      editor instanceof HTMLTextAreaElement ||
      editor instanceof HTMLSelectElement
    ) {
      return editor.value;
    }
    if (editor?.isContentEditable) return editor.innerText;
    return rowsRef.current[index]?.[key] ?? "";
  }

  function rememberSmartCellDraft(index, key, value, target) {
    const cellKey = `${index}:${key}`;
    suggestionCommittedCellsRef.current.delete(cellKey);
    cellDraftsRef.current.set(cellKey, String(value ?? ""));
    updateSmartSuggestionIndex(-1);
    if (Date.now() < nativeHistoryUntilRef.current) return;
    if (optionsForCell(key).length) {
      if (activeCellRef.current !== cellKey || !suggestionRect) {
        openCellSuggestions(cellKey, target);
      }
      window.cancelAnimationFrame(suggestionDraftFrameRef.current);
      suggestionDraftFrameRef.current = window.requestAnimationFrame(() => {
        setSuggestionDraftVersion((current) => current + 1);
      });
    }
  }

  function isCurrentSmartEditSession(cellKey, sessionId) {
    if (sessionId === undefined || sessionId === null) return true;
    return (
      Number(sessionId) === activeEditSessionRef.current &&
      editingSessionCellRef.current === cellKey
    );
  }

  function commitSmartCellEdit(index, key, draftValue, options = {}) {
    const cellKey = `${index}:${key}`;
    if (!isCurrentSmartEditSession(cellKey, options.sessionId)) {
      return rowsRef.current[index]?.[key] ?? "";
    }
    if (suggestionCommittedCellsRef.current.has(cellKey)) {
      suggestionCommittedCellsRef.current.delete(cellKey);
      cellDraftsRef.current.delete(cellKey);
      return rowsRef.current[index]?.[key] ?? "";
    }
    const value =
      draftValue !== undefined ? String(draftValue ?? "") : smartCellDraftValue(index, key);
    cellDraftsRef.current.delete(cellKey);
    updateRow(index, key, value);
    return value;
  }

  function finishSmartCellEdit(index, key, {
    draftValue,
    event,
    navigation = "none",
    arrow = "",
    sessionId = activeEditSessionRef.current,
  } = {}) {
    const cellKey = `${index}:${key}`;
    if (!isCurrentSmartEditSession(cellKey, sessionId)) return false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const value =
      draftValue !== undefined
        ? draftValue
        : smartDraftValueFromKeyboardTarget(event, cellKey);
    commitSmartCellEdit(index, key, value, { sessionId });
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    if (navigation === "down") {
      moveSmartCellDown(index, key);
      return true;
    }
    if (navigation === "arrow" && arrow) {
      selectSmartCellByArrow(index, key, arrow, event?.shiftKey);
      return true;
    }
    updateSmartEditingCell("");
    updateSmartSelection(selectionForCells(index, key));
    focusCellContainer(index, key);
    return true;
  }

  function hasUncommittedSmartCellDraft(cellKey = editingCellRef.current) {
    const separator = String(cellKey || "").indexOf(":");
    if (separator <= 0) return false;
    const index = Number(cellKey.slice(0, separator));
    const key = cellKey.slice(separator + 1);
    if (!Number.isInteger(index) || !smartCellOrder.includes(key)) return false;
    return (
      String(smartCellDraftValue(index, key) ?? "") !==
      String(rowsRef.current[index]?.[key] ?? "")
    );
  }

  function rowsWithCommittedSmartEditorBuffer(list = rowsRef.current) {
    const cellKey = editingCellRef.current;
    const separator = cellKey.indexOf(":");
    if (separator <= 0) return cloneSmartRows(list);
    const index = Number(cellKey.slice(0, separator));
    const key = cellKey.slice(separator + 1);
    if (
      !Number.isInteger(index) ||
      !smartCellOrder.includes(key) ||
      !list[index]
    ) {
      return cloneSmartRows(list);
    }
    const value = smartCellDraftValue(index, key);
    const next = cloneSmartRows(list);
    const row = next[index];
    const patch = {
      [key]: value ?? "",
      _gridGhost: false,
      _touched: { ...(row._touched || {}), [key]: true },
    };
    if (key === "description") {
      const defaults = defaultsForDescription(value, next, index);
      if (defaults) {
        for (const copyKey of [
          "building_unit",
          "floor_apartment",
          "glass_spec",
          "profile_spec",
          "color",
          "rate",
          "completion_ratio",
          "unit_code",
          "measurement_mode",
        ]) {
          if (!row[copyKey] && defaults[copyKey]) {
            patch[copyKey] = defaults[copyKey];
            patch._touched[copyKey] = true;
          }
        }
      }
    }
    next[index] = { ...row, ...patch };
    return next;
  }

  function copySelectedRangeDown() {
    const selection = rangeSelectionRef.current;
    const range = normalizedRange();
    if (!range || range.rowEnd <= range.rowStart) {
      return false;
    }
    const committedRows = rowsWithCommittedSmartEditorBuffer();
    const viewRows = currentSmartViewRowList();
    const sourceViewRow = viewRows[range.rowStart];
    if (!sourceViewRow?._gridId) return false;
    const sourceRow =
      committedRows.find((row) => row._gridId === sourceViewRow._gridId) ||
      sourceViewRow;
    const targetRowIds = new Set();
    for (let rowIndex = range.rowStart + 1; rowIndex <= range.rowEnd; rowIndex += 1) {
      const row = viewRows[rowIndex];
      if (row?._gridId) targetRowIds.add(row._gridId);
    }
    if (!targetRowIds.size) return false;
    const copyKeys = smartCellOrder.slice(range.colStart, range.colEnd + 1);
    const normalized = normalizeSmartRows(
      committedRows.map((row) => {
        if (!targetRowIds.has(row._gridId)) return row;
        const patch = {};
        for (const columnKey of copyKeys) {
          patch[columnKey] = sourceRow[columnKey] ?? "";
        }
        return {
          ...row,
          ...patch,
          _gridGhost: false,
          _manualBlank: false,
          _touched: {
            ...(row._touched || {}),
            ...touchedPatch(copyKeys),
          },
        };
      }),
    );
    recordSmartHistory(committedRows);
    setPreviewData(null);
    setEntryDirty?.(true);
    rowsRef.current = normalized;
    markGridMutation();
    setRows(normalized);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    focusSmartCellPoint(
      selection?.focusCell ||
        smartCellPointFromViewIndex(range.rowStart, smartCellOrder[range.colStart]),
    );
    return true;
  }

  function handleCloseEditor() {
    setPreviewData(null);
    setDeletedRowIds([]);
    setSaving(false);
    setRows([smartRowFrom(variantEntryDefaults())]);
    updateSmartSelection(null);
    setEditingId?.(null);
    setEntryDirty?.(false);
    (onCloseContext || onBack)?.({ force: true });
    restoreInputInteractivity();
  }

  function validateMain() {
    if (
      entryForm.document_type === "invoice" &&
      !canUser(currentUser, "can_create_invoices")
    ) {
      return "هذا المستخدم غير مسموح له بإنشاء فواتير معتمدة.";
    }
    if (
      String(entryForm.document_status || "") !== String(meta.status || "") &&
      !canUser(currentUser, "can_change_status")
    ) {
      return "هذا المستخدم غير مسموح له بتغيير حالة المستند.";
    }
    const missing = [];
    if (!entryForm.document_type) missing.push("نوع المستند");
    if (!isDocumentEdit && !entryForm.party_category) missing.push("تصنيف العميل");
    if (!isDocumentEdit && !String(entryForm.base_party_name || "").trim())
      missing.push("اسم العميل/المقاول");
    if (!isDocumentEdit && !String(entryForm.project || "").trim()) missing.push("المشروع");
    if (!isDocumentEdit &&
      entryForm.document_type !== "contractor_certificate" &&
      !String(entryForm.work_type || "").trim()
    )
      missing.push("نوع الأعمال");
    if (!isDocumentEdit &&
      entryForm.document_type === "contractor_certificate" &&
      !selectedWorkTypes.length
    )
      missing.push("نوع أعمال واحد على الأقل");
    if (!isDocumentEdit &&
      entryForm.document_type === "contractor_certificate" &&
      !String(entryForm.certificate_no || "").trim()
    )
      missing.push("رقم المستخلص");
    if (!isDocumentEdit && !String(entryForm.entry_date || "").trim()) missing.push("التاريخ");
    if (missing.length)
      return `لا يمكن الحفظ قبل استكمال البيانات الرئيسية: ${missing.join("، ")}`;
    return "";
  }

  function buildPreview() {
    const validation = validateMain();
    if (validation) {
      setMessage(validation);
      return null;
    }
    if (!rowData.length && !isDocumentEdit) {
      setMessage(
        "لا يمكن الحفظ أو المعاينة بدون إدخال بند واحد على الأقل في الجدول.",
      );
      return null;
    }
    if (
      entryForm.document_type === "contractor_certificate" &&
      rowData.some((row) => !String(row.work_type || "").trim())
    ) {
      setMessage("اختر نوع الأعمال لكل بند في مستخلص المقاول.");
      return null;
    }
    const calculatedRows = rowData.map((row, index) =>
      calculateDraftRow(
        {
          ...row,
          id: `draft-${index + 1}`,
          building_unit: row._touched?.building_unit
            ? row.building_unit || ""
            : row.building_unit || entryForm.building_unit,
          floor_apartment: row._touched?.floor_apartment
            ? row.floor_apartment || ""
            : row.floor_apartment || entryForm.floor_apartment,
          entry_date: entryForm.entry_date,
          work_type: row.work_type || entryForm.work_type,
        },
        entryForm,
      ),
    );
    const documentLocation = singleDocumentLocation(entryForm, calculatedRows);
    const usesCompletion = ["invoice", "contractor_certificate"].includes(
      entryForm.document_type,
    );
    const totals = calculatedRows.reduce(
      (acc, row) => {
        acc.quantity += num(row.quantity);
        acc.real_gross_total += num(row.gross_total);
        acc.gross_total += usesCompletion
          ? num(row.work_gross_total)
          : num(row.gross_total);
        acc.net_total += usesCompletion
          ? num(row.work_net_total)
          : num(row.net_total);
        return acc;
      },
      {
        quantity: 0,
        real_gross_total: 0,
        gross_total: 0,
        net_total: 0,
        debit: 0,
        credit: 0,
      },
    );
    const discountValue = num(entryForm.discount_value);
    let discountAmount = 0;
    if (entryForm.discount_type === "rate")
      discountAmount = totals.net_total * (discountValue / 100);
    if (entryForm.discount_type === "amount") discountAmount = discountValue;
    totals.discount_amount = roundMoney(discountAmount);
    totals.net_total = roundMoney(totals.net_total - discountAmount);
    return {
      title: documentTypeLabel(entryForm.document_type),
      type:
        entryForm.document_type === "invoice"
          ? "invoice"
          : entryForm.document_type === "contractor_certificate"
            ? "contractor"
            : "offer",
      vat_enabled: !!entryForm.vat_enabled,
      vat_terms_only: !!entryForm.vat_terms_only,
      operation_no: entryForm.operation_no || nextDoc?.operation_no || "Auto",
      serial: entryForm.serial || nextDoc?.next_no || "",
      party:
        entryForm.party_category === "corporate"
          ? `شركة ${entryForm.base_party_name}`
          : entryForm.party_category === "unselected"
            ? entryForm.base_party_name
            : entryForm.party_category === "engineer"
              ? `م. ${entryForm.base_party_name}`
              : entryForm.base_party_name,
      project: entryForm.project,
      building_unit: documentLocation,
      overall_work_type: uniqueValues(calculatedRows.map((row) => row.work_type)).join("، "),
      entry_date: entryForm.entry_date,
      generated_at: new Date().toISOString(),
      totals,
      tax_breakdown: TAXES.map((tax) => ({
        key: tax.key,
        label: tax.label,
        amount: calculatedRows.reduce((sum, row) => {
          const amountKey =
            tax.amountKey || tax.key.replace("_enabled", "_amount");
          const workKey = `work_${amountKey}`;
          return (
            sum + (usesCompletion ? num(row[workKey]) : num(row[amountKey]))
          );
        }, 0),
      })).filter((tax) => tax.amount),
      discount_label:
        entryForm.discount_type === "rate" && discountValue
          ? `خصم خاص ${money(discountValue)}%`
          : entryForm.discount_type === "amount" && discountValue
            ? `خصم خاص ${money(discountValue)} جنيه`
            : "",
      rows: calculatedRows,
      statementRows: [],
      summaryRows: [],
    };
  }

  function previewDraft() {
    const preview = buildPreview();
    if (preview) {
      setPreviewData(preview);
      setMessage("تم تجهيز معاينة الإدخال. راجع البنود ثم اضغط اعتماد وحفظ.");
    }
  }

  async function submitDraft() {
    const preview = previewData || buildPreview();
    if (!preview) return;
    const rowsToSave = (preview.rows || []).filter(rowHasData);
    if (!rowsToSave.length && !isDocumentEdit) {
      setMessage("Cannot save a document without at least one real item row.");
      return;
    }
    const documentLocation = singleDocumentLocation(entryForm, rowsToSave);
    const targetNo = entryForm.operation_no || nextDoc?.operation_no || "Auto";
    if (!(await askForConfirmation({
      title: "اعتماد وحفظ المستند",
      message: `سيتم حفظ ${rowsToSave.length} بند تحت المستند ${targetNo}. يثبت رقم المستند بعد الحفظ.`,
      confirmLabel: "حفظ المستند",
    }))) {
      restoreInputInteractivity();
      return;
    }
    setSaving(true);
    try {
      const saveRevision = gridRevisionRef.current;
      let documentId = entryForm.document_id || "";
      let operationNo = documentId ? entryForm.operation_no || "" : "";
      let serial = documentId ? entryForm.serial || "" : "";
      let firstSaved = null;
      let lastSaved = null;
      let batchSavedRows = [];
      const emptiedExistingRowIds = rows
        .filter((row) => row._existingId && !rowHasData(row))
        .map((row) => row._existingId);
      const deleteIds = [
        ...new Set([...deletedRowIds, ...emptiedExistingRowIds]),
      ];
      const batchRows = rowsToSave.map((row) => {
        const existingId = row._existingId;
        const {
          _existingId,
          _gridId,
          _gridGhost,
          _manualBlank,
          _touched,
          _originalBuildingUnit,
          _originalFloorApartment,
          id: _draftId,
          ...cleanRow
        } = row;
        const savedBuildingUnit = _touched?.building_unit
          ? cleanRow.building_unit || ""
          : cleanRow.building_unit || _originalBuildingUnit || entryForm.building_unit || "";
        const savedFloorApartment = _touched?.floor_apartment
          ? cleanRow.floor_apartment || ""
          : cleanRow.floor_apartment ||
            _originalFloorApartment ||
            entryForm.floor_apartment ||
            "";
        return {
          client_row_id: _gridId,
          existing_id: existingId || null,
          data: {
            ...entryForm,
            ...cleanRow,
            customer_name: entryForm.base_party_name,
            customer_display_name: "",
            building_unit: savedBuildingUnit,
            floor_apartment: savedFloorApartment,
            created_by: currentUser?.display_name,
            updated_by: currentUser?.display_name,
          },
        };
      });
      if (batchRows.length || deleteIds.length) {
        const batchStartedAt = performanceStart();
        const batch = await api.request("/api/entries/batch", {
          method: "POST",
          body: JSON.stringify({
            document_id: documentId,
            operation_no: operationNo,
            serial,
            delete_ids: deleteIds,
            rows: batchRows,
          }),
        });
        const savedRows = batch?.rows || [];
        batchSavedRows = savedRows;
        firstSaved = savedRows[0] || null;
        lastSaved = savedRows.at(-1) || null;
        documentId = batch?.document_id || firstSaved?.document_id || documentId;
        operationNo =
          batch?.operation_no || firstSaved?.operation_no || operationNo;
        serial = batch?.serial || firstSaved?.serial || serial;
        logDevelopmentPerformance(
          `Persistence batch ${batchRows.length} rows`,
          batchStartedAt,
        );
      }
      let updatedDocument = null;
      if (documentId) {
        updatedDocument = await api.request(`/api/documents/${documentId}`, {
          method: "PUT",
          body: JSON.stringify({
            status: entryForm.document_status,
            document_type: entryForm.document_type,
            project: entryForm.project,
            building_unit: documentLocation,
            entry_date: entryForm.entry_date,
            party_id: firstSaved?.party_id || lastSaved?.party_id || entryForm.party_id || null,
            party_role: entryForm.party_role,
            party_category: entryForm.party_category,
            customer_name: firstSaved?.customer_name || entryForm.base_party_name,
            search_party_name: firstSaved?.search_party_name || entryForm.search_party_name || entryForm.base_party_name,
            discount_type: entryForm.discount_type || "none",
            discount_value: num(entryForm.discount_value),
          }),
        });
        operationNo = updatedDocument?.operation_no || operationNo;
        serial = updatedDocument?.document_no || serial;
      }
      const savedDocument = {
        id: documentId,
        document_id: documentId,
        document_type: updatedDocument?.document_type || entryForm.document_type,
        status: updatedDocument?.status || entryForm.document_status,
        operation_no: operationNo,
        document_no: serial,
        party_id:
          firstSaved?.party_id ||
          lastSaved?.party_id ||
          entryForm.party_id ||
          "",
        party_role: entryForm.party_role,
        category: entryForm.party_category,
        base_party_name: entryForm.base_party_name,
        customer_name: firstSaved?.customer_name || entryForm.base_party_name,
        display_name:
          firstSaved?.customer_display_name || entryForm.base_party_name,
        project: entryForm.project,
        building_unit: documentLocation,
      };
      const resetEntry = variantEntryDefaults({
        document_type: entryForm.document_type,
        document_status: meta.status,
        party_role: meta.role,
        party_category: entryForm.party_category || "unselected",
      });
      setMessage(
        `Saved document ${operationNo || ""} with ${rowsToSave.length} item(s).`,
      );
      const saveFinishedWithoutNewEdits =
        gridRevisionRef.current === saveRevision;
      if (saveFinishedWithoutNewEdits) {
        const resetRows = [smartRowFrom(resetEntry)];
        setEntryForm(resetEntry);
        rowsRef.current = resetRows;
        setRows(resetRows);
        updateSmartSelection(null);
        deletedRowIdsRef.current = [];
        setDeletedRowIds([]);
        setPreviewData(null);
        setEditingId(null);
        setEntryDirty?.(false);
      } else {
        const savedIdByGridId = new Map(
          batchSavedRows
            .filter(Boolean)
            .map((saved) => [saved.client_row_id, saved.id]),
        );
        const reconciledRows = rowsRef.current.map((row) => ({
          ...row,
          _existingId:
            savedIdByGridId.get(row._gridId) || row._existingId || "",
        }));
        rowsRef.current = reconciledRows;
        setRows(reconciledRows);
        const savedDeleteIds = new Set(deleteIds.map(Number));
        const remainingDeletedIds = deletedRowIdsRef.current.filter(
          (id) => !savedDeleteIds.has(Number(id)),
        );
        deletedRowIdsRef.current = remainingDeletedIds;
        setDeletedRowIds(remainingDeletedIds);
        setEntryForm((current) => ({
          ...current,
          document_id: documentId,
          operation_no: operationNo,
          serial,
        }));
        setEntryDirty?.(true);
        setMessage(
          "تم حفظ النسخة المرسلة، والتعديلات التي أُدخلت أثناء الحفظ ما زالت غير محفوظة.",
        );
      }
      if (saveFinishedWithoutNewEdits) {
        await refreshAll?.();
        onDocumentSaved?.(savedDocument);
      }
    } catch (error) {
      setMessage(`Could not save document: ${error.message}`);
    } finally {
      setSaving(false);
      restoreInputInteractivity();
    }
  }

  function optionsForCell(key) {
    return (
      {
        work_type: selectedWorkTypes.length ? selectedWorkTypes : workTypeOptions,
        building_unit: buildingOptions,
        floor_apartment: unitOptions,
        description: descriptionOptions,
        glass_spec: glassOptions,
        profile_spec: profileOptions,
        color: colorOptions,
      }[key] || []
    );
  }

  async function deleteSmartSelection(fallbackIndex = null) {
    const range = normalizedRange();
    const viewRows = currentSmartViewRowList();
    const selectedRowIds = new Set();
    for (let rowIndex = range?.rowStart ?? 0; rowIndex <= (range?.rowEnd ?? -1); rowIndex += 1) {
      const row = viewRows[rowIndex];
      if (row?._gridId) selectedRowIds.add(row._gridId);
    }
    if (
      !range ||
      (fallbackIndex !== null &&
        !selectedRowIds.has(rowsRef.current[fallbackIndex]?._gridId))
    ) {
      return false;
    }
    const fullRowsSelected =
      range.colStart === 0 && range.colEnd === smartCellOrder.length - 1;
    if (!fullRowsSelected) {
      recordSmartHistory();
      setPreviewData(null);
      setEntryDirty?.(true);
      const nextRows = normalizeSmartRows(
        rowsRef.current.map((row, rowIndex) => {
          if (!selectedRowIds.has(row._gridId)) return row;
          const patch = {};
          const touched = { ...(row._touched || {}) };
          for (let column = range.colStart; column <= range.colEnd; column += 1) {
            const key = smartCellOrder[column];
            patch[key] = "";
            touched[key] = true;
          }
          return { ...row, ...patch, _touched: touched };
        }),
      );
      rowsRef.current = nextRows;
      markGridMutation();
      setRows(nextRows);
      updateSmartActiveCell("");
      setSuggestionRect(null);
      restoreInputInteractivity();
      return true;
    }
    const selectedIndexes = new Set();
    rowsRef.current.forEach((row, index) => {
      if (selectedRowIds.has(row._gridId) && rowHasData(row)) selectedIndexes.add(index);
    });
    if (!selectedIndexes.size) return true;
    if (!(await askForConfirmation({
      title: "حذف الصفوف المحددة",
      message: `سيتم حذف ${selectedIndexes.size} صف محدد من المستند عند الحفظ.`,
      confirmLabel: "حذف الصفوف",
      danger: true,
    }))) {
      restoreInputInteractivity();
      return true;
    }
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    const ids = [...selectedIndexes]
      .map((index) => rowsRef.current[index]?._existingId)
      .filter(Boolean);
    if (ids.length) {
      const nextDeletedIds = [
        ...new Set([...deletedRowIdsRef.current, ...ids]),
      ];
      deletedRowIdsRef.current = nextDeletedIds;
      setDeletedRowIds(nextDeletedIds);
    }
    const nextRows = normalizeSmartRows(
      rowsRef.current.filter((_, rowIndex) => !selectedIndexes.has(rowIndex)),
    );
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    const nextIndex = Math.min(range.rowStart, nextRows.length - 1);
    const nextSelection = selectionForCells(
      nextIndex,
      smartCellOrder[range.colStart] || smartCellOrder[0],
    );
    updateSmartSelection(nextSelection);
    updateSmartEditingCell("");
    focusSmartCellPoint(nextSelection?.focusCell);
    restoreInputInteractivity();
    return true;
  }

  function focusCellContainer(index, key, attempt = 0) {
    window.requestAnimationFrame(() => {
      const target = document.querySelector(
        `[data-smart-cell-container="${index}:${key}"]`,
      );
      if (!target && attempt < 2) {
        const scrollHost = smartTableScrollRef.current;
        if (scrollHost) {
          const visualIndex = smartViewRowsRef.current.findIndex(
            (entry) => entry.index === index,
          );
          const scrollIndex = visualIndex >= 0 ? visualIndex : index;
          scrollHost.scrollTop = Math.max(
            0,
            scrollIndex * Math.max(42, rowHeightRef.current) -
              scrollHost.clientHeight / 2,
          );
          setSmartViewport({
            scrollTop: scrollHost.scrollTop,
            height: scrollHost.clientHeight || 640,
          });
        }
        focusCellContainer(index, key, attempt + 1);
        return;
      }
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      target?.focus({ preventScroll: true });
    });
  }

  function focusSmartCellPoint(point) {
    const rowIndex = smartActualIndexForPoint(point);
    if (rowIndex < 0) return;
    focusCellContainer(rowIndex, point.columnKey);
  }

  function moveSmartCellDown(index, key) {
    const currentPoint = smartCellPoint(index, key);
    const currentVisual = smartCellIndexes(currentPoint);
    const viewRows = currentSmartViewRowList();
    const nextVisualIndex =
      currentVisual?.rowIndex === undefined ? -1 : currentVisual.rowIndex + 1;
    let nextIndex =
      nextVisualIndex >= 0 && nextVisualIndex < smartViewRowsRef.current.length
        ? smartViewRowsRef.current[nextVisualIndex].index
        : index + 1;
    window.clearTimeout(suggestionTimerRef.current);
    if (nextIndex >= rowsRef.current.length) {
      const next = [...rowsRef.current];
      while (next.length <= nextIndex) next.push(smartRowFrom());
      const normalized = normalizeSmartRows(next);
      rowsRef.current = normalized;
      flushSync(() => setRows(normalized));
      nextIndex = Math.min(nextIndex, normalized.length - 1);
    } else if (viewRows.length && nextVisualIndex >= viewRows.length) {
      nextIndex = Math.min(rowsRef.current.length - 1, nextIndex);
    }
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    updateSmartSelection(selectionForCells(nextIndex, key));
    focusCellContainer(nextIndex, key);
  }

  function selectSmartCell(index, key, extend = false) {
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    const destination = smartCellPoint(index, key);
    updateSmartSelection((current) =>
      smartSelectionAfterNavigation({
        selection: current,
        destination,
        extendSelection: extend,
      }),
    );
    focusCellContainer(index, key);
  }

  function beginSmartCellEdit(index, key, replacement) {
    const cellKey = `${index}:${key}`;
    suggestionCommittedCellsRef.current.delete(cellKey);
    cellDraftsRef.current.set(
      cellKey,
      String(
        replacement !== undefined
          ? replacement
          : rowsRef.current[index]?.[key] ?? "",
      ),
    );
    updateSmartEditingCell(cellKey);
    const sessionId = activeEditSessionRef.current;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (
        sessionId !== activeEditSessionRef.current ||
        editingSessionCellRef.current !== cellKey
      ) {
        return;
      }
      const target = document.querySelector(`[data-smart-cell="${cellKey}"]`);
      target?.focus({ preventScroll: true });
      const anchor =
        document.querySelector(`[data-smart-cell-container="${cellKey}"]`) ||
        target;
      if (replacement !== undefined && anchor && optionsForCell(key).length) {
        positionCellSuggestions(cellKey, anchor, { resetIndex: true });
      }
      if (target instanceof HTMLInputElement) {
        target.setSelectionRange?.(target.value.length, target.value.length);
      }
      if (target?.isContentEditable) {
        const selection = window.getSelection?.();
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }));
  }

  function smartCellFromKeyboardEvent(event) {
    const container = event.target?.closest?.("[data-smart-cell-container]");
    const encoded = container?.getAttribute?.("data-smart-cell-container") || "";
    const separator = encoded.indexOf(":");
    if (separator > 0) {
      const index = Number(encoded.slice(0, separator));
      const key = encoded.slice(separator + 1);
      if (Number.isInteger(index) && smartCellOrder.includes(key)) {
        return { index, key, cellKey: `${index}:${key}` };
      }
    }
    const focus = smartCellIndexes(rangeSelectionRef.current?.focusCell);
    if (!focus) return null;
    const focusPoint = rangeSelectionRef.current?.focusCell;
    const key = focusPoint?.columnKey || smartCellOrder[focus.columnIndex];
    const index = smartActualIndexForPoint(focusPoint);
    if (index < 0) return null;
    return { index, key, cellKey: `${index}:${key}` };
  }

  function shownSuggestionsForCell(index, key) {
    const options = optionsForCell(key);
    const typed = normalizeArabic(smartCellDraftValue(index, key) || "");
    const matching = options.filter(
      (option) => !typed || normalizeArabic(option).includes(typed),
    );
    return (typed ? matching : options).slice(0, 8);
  }

  function smartDraftValueFromKeyboardTarget(event, cellKey) {
    const target = event?.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return target.value;
    }
    if (target?.isContentEditable) return target.innerText;
    const editor = document.querySelector(`[data-smart-cell="${cellKey}"]`);
    if (
      editor instanceof HTMLInputElement ||
      editor instanceof HTMLTextAreaElement ||
      editor instanceof HTMLSelectElement
    ) {
      return editor.value;
    }
    if (editor?.isContentEditable) return editor.innerText;
    return undefined;
  }

  function selectSmartCellByArrow(index, key, arrow, extend = false) {
    const selection = rangeSelectionRef.current || selectionForCells(index, key);
    const viewRows = currentSmartViewRowList();
    const currentFocus = smartCellIndexes(selection?.focusCell) || {
      rowIndex: Math.max(
        0,
        viewRows.findIndex(
          (row) => row._gridId === rowsRef.current[index]?._gridId,
        ),
      ),
      columnIndex: smartCellOrder.indexOf(key),
    };
    const nextRow =
      arrow === "ArrowDown"
        ? Math.min(viewRows.length - 1, currentFocus.rowIndex + 1)
        : arrow === "ArrowUp"
          ? Math.max(0, currentFocus.rowIndex - 1)
          : currentFocus.rowIndex;
    const nextColumn =
      arrow === "ArrowLeft"
        ? Math.min(smartCellOrder.length - 1, currentFocus.columnIndex + 1)
        : arrow === "ArrowRight"
          ? Math.max(0, currentFocus.columnIndex - 1)
          : currentFocus.columnIndex;
    const destination = smartCellPointFromViewIndex(
      nextRow,
      smartCellOrder[nextColumn],
    );
    const nextSelection = smartSelectionAfterNavigation({
      selection,
      destination,
      extendSelection: extend,
    });
    updateSmartSelection(nextSelection);
    updateSmartEditingCell("");
    updateSmartActiveCell("");
    setSuggestionRect(null);
    updateSmartSuggestionIndex(-1);
    focusSmartCellPoint(nextSelection?.focusCell);
  }

  function handleGridKeyDown(event) {
    const cell = smartCellFromKeyboardEvent(event);
    if (!cell) return;
    const { index, key, cellKey } = cell;
    const controlPressed = event.ctrlKey || event.metaKey;
    const arrowKey = [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
    ].includes(event.key);
    const isEditing = editingCellRef.current === cellKey;
    const selection =
      rangeSelectionRef.current || selectionForCells(index, key);

    if (isSmartFillDownShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) copySelectedRangeDown();
      return;
    }

    if (controlPressed && arrowKey) {
      event.preventDefault();
      event.stopPropagation();
      updateSmartEditingCell("");
      updateSmartActiveCell("");
      setSuggestionRect(null);
      const focusCell = selection?.focusCell || smartCellPoint(index, key);
      const destination = findSmartCtrlArrowDestination({
        rows: rowsRef.current,
        columnOrder: smartCellOrder,
        focusCell,
        direction: event.key,
      });
      const nextSelection = smartSelectionAfterNavigation({
        selection,
        destination,
        extendSelection: event.shiftKey,
      });
      updateSmartSelection(nextSelection);
      focusSmartCellPoint(nextSelection?.focusCell);
      return;
    }

    if (controlPressed && event.key.toLowerCase() === "c") {
      if (!hasSelectedTextInsideEditor(event.target)) {
        const selectedText = selectedRangeText();
        if (selectedText) {
          event.preventDefault();
          event.stopPropagation();
          rememberSmartClipboard(selectedText);
          copyTextToClipboard(selectedText).catch(() => {});
        }
      }
      return;
    }

    const shownOptions = shownSuggestionsForCell(index, key);
    const suggestionsOpen =
      isEditing &&
      activeCellRef.current === cellKey &&
      shownOptions.length > 0;
    const hasExplicitSuggestion =
      suggestionsOpen &&
      activeSuggestionIndexRef.current >= 0 &&
      activeSuggestionIndexRef.current < shownOptions.length;

    if (isEditing) {
      if (
        suggestionsOpen &&
        (event.key === "ArrowDown" ||
          event.key === "ArrowUp")
      ) {
        event.preventDefault();
        event.stopPropagation();
        const delta =
          event.key === "ArrowUp" ? -1 : 1;
        updateSmartSuggestionIndex(
          (current) => {
            if (current < 0) return delta > 0 ? 0 : shownOptions.length - 1;
            return (current + delta + shownOptions.length) % shownOptions.length;
          },
        );
        return;
      }
      if (event.key === "Enter") {
        if (event.repeat) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const sessionId = activeEditSessionRef.current;
        if (hasExplicitSuggestion) {
          event.preventDefault();
          event.stopPropagation();
          applyCellSuggestion(
            index,
            key,
            shownOptions[activeSuggestionIndexRef.current],
            { moveDown: true, sessionId },
          );
        } else {
          finishSmartCellEdit(index, key, {
            event,
            draftValue: smartDraftValueFromKeyboardTarget(event, cellKey),
            navigation: "down",
            sessionId,
          });
        }
        return;
      }
      if (SMART_NUMERIC_CLIPBOARD_KEYS.has(key) && arrowKey) {
        if (event.repeat) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        finishSmartCellEdit(index, key, {
          event,
          draftValue: smartDraftValueFromKeyboardTarget(event, cellKey),
          navigation: "arrow",
          arrow: event.key,
          sessionId: activeEditSessionRef.current,
        });
        return;
      }
      if (event.key === "Escape") {
        finishSmartCellEdit(index, key, {
          event,
          draftValue: smartDraftValueFromKeyboardTarget(event, cellKey),
          sessionId: activeEditSessionRef.current,
        });
        return;
      }
      if (event.key === "Tab" && !suggestionsOpen) {
        event.preventDefault();
        event.stopPropagation();
        const sessionId = activeEditSessionRef.current;
        if (!isCurrentSmartEditSession(cellKey, sessionId)) return;
        commitSmartCellEdit(
          index,
          key,
          smartDraftValueFromKeyboardTarget(event, cellKey),
          { sessionId },
        );
        const columnIndex = smartCellOrder.indexOf(key);
        const nextColumn = event.shiftKey
          ? Math.max(0, columnIndex - 1)
          : Math.min(smartCellOrder.length - 1, columnIndex + 1);
        selectSmartCell(index, smartCellOrder[nextColumn], false);
      }
      // In edit mode all unhandled arrows remain native caret/text navigation.
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      deleteSmartSelection(index);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      moveSmartCellDown(index, key);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      return;
    }
    if (
      event.key.length === 1 &&
      !controlPressed &&
      !event.altKey
    ) {
      event.preventDefault();
      beginSmartCellEdit(
        index,
        key,
        ["unit_code", "measurement_mode"].includes(key)
          ? undefined
          : event.key,
      );
      return;
    }
    if (!arrowKey) return;

    event.preventDefault();
    selectSmartCellByArrow(index, key, event.key, event.shiftKey);
  }

  async function deleteSmartRowById(rowId, { ignoreSelection = false } = {}) {
    dismissSmartCellUi();
    const initialIndex = rowsRef.current.findIndex(
      (row) => row._gridId === rowId,
    );
    if (initialIndex < 0) return;
    const selectedRange = normalizedRange();
    const hasRealRangeSelection =
      selectedRange &&
      (selectedRange.rowStart !== selectedRange.rowEnd ||
        selectedRange.colStart !== selectedRange.colEnd);
    if (
      !ignoreSelection &&
      hasRealRangeSelection &&
      initialIndex >= selectedRange.rowStart &&
      initialIndex <= selectedRange.rowEnd &&
      (await deleteSmartSelection(initialIndex))
    ) {
      return;
    }
    const removed = rowsRef.current[initialIndex];
    const isEmptyDraftRow = !rowHasData(removed) && !removed?._existingId;
    if (!isEmptyDraftRow && !(await askForConfirmation({
      title: "هل تريد حذف هذا الصف؟",
      message: "سيتم حذف هذا الصف نهائياً من المستند عند الحفظ.",
      confirmLabel: "حذف",
      danger: true,
    }))) {
      restoreInputInteractivity();
      return;
    }
    const index = rowsRef.current.findIndex((row) => row._gridId === rowId);
    if (index < 0) {
      restoreInputInteractivity();
      return;
    }
    const latestRemoved = rowsRef.current[index];
    recordSmartHistory();
    setPreviewData(null);
    setEntryDirty?.(true);
    if (latestRemoved?._existingId) {
      const nextDeletedIds = deletedRowIdsRef.current.includes(latestRemoved._existingId)
        ? deletedRowIdsRef.current
        : [...deletedRowIdsRef.current, latestRemoved._existingId];
      deletedRowIdsRef.current = nextDeletedIds;
      setDeletedRowIds(nextDeletedIds);
    }
    const removal = removeSmartRowById(rowsRef.current, rowId);
    if (!removal) {
      restoreInputInteractivity();
      return;
    }
    const nextRows = normalizeSmartRows(removal.rows);
    rowsRef.current = nextRows;
    markGridMutation();
    setRows(nextRows);
    const nextIndex = Math.min(index, nextRows.length - 1);
    const nextSelection = selectionForCells(
      nextIndex,
      smartCellOrder[0],
    );
    updateSmartSelection(nextSelection);
    focusSmartCellPoint(nextSelection?.focusCell);
    restoreInputInteractivity();
  }

  async function deleteSmartRow(index) {
    const rowId = rowsRef.current[index]?._gridId;
    if (rowId) await deleteSmartRowById(rowId);
  }

  const rowInput = (index, key, extra = {}) => {
    const { list: _unusedList, ...inputProps } = extra;
    const value = rows[index][key] || "";
    const numericCell = SMART_NUMERIC_CLIPBOARD_KEYS.has(key);
    const cellInputProps = { ...inputProps };
    if (numericCell || cellInputProps.type === "number") {
      delete cellInputProps.step;
      delete cellInputProps.min;
      delete cellInputProps.max;
      cellInputProps.type = "text";
      cellInputProps.inputMode = "decimal";
      cellInputProps.onWheel = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
    }
    const options = optionsForCell(key);
    const cellKey = `${index}:${key}`;
    const cellEditSessionId = editingCell === cellKey ? activeEditSession : 0;
    const editorValue =
      editingCell === cellKey && cellDraftsRef.current.has(cellKey)
        ? cellDraftsRef.current.get(cellKey)
        : value;
    const typed = normalizeArabic(editorValue);
    const matchingOptions = options.filter(
      (option) => !typed || normalizeArabic(option).includes(typed),
    );
    const shownOptions = (typed ? matchingOptions : options).slice(0, 8);
    const showSuggestions =
      editingCell === cellKey && activeCell === cellKey && shownOptions.length > 0;
    const highlightedSuggestionIndex =
      activeSuggestionIndex >= 0 && activeSuggestionIndex < shownOptions.length
        ? activeSuggestionIndex
        : -1;
    const multiline = [
      "description",
      "glass_spec",
      "profile_spec",
      "color",
    ].includes(key);
    const focusHandlers = {
      onFocus: (event) => {
        updateSmartSelection(selectionForCells(index, key));
        if (
          editingCellRef.current === cellKey &&
          activeCellRef.current === cellKey
        ) {
          openCellSuggestionsFromFocus(cellKey, event.currentTarget);
        }
      },
      onClick: (event) => {
        window.clearTimeout(suggestionTimerRef.current);
        delete event.currentTarget.dataset.suggestionDelayUntil;
      },
      onDoubleClick: (event) => {
        event.stopPropagation();
        window.clearTimeout(suggestionTimerRef.current);
        delete event.currentTarget.dataset.suggestionDelayUntil;
      },
      onBlur: closeCellSuggestions,
    };
    return (
      <div
        className={`cell-combo${isCellSelected(index, key) ? " selected-cell" : ""}${fieldCopyDownKeys.has(key) ? " copyable-cell" : ""}`}
        data-smart-cell-container={cellKey}
        data-suggestion-options-count={options.length}
        data-suggestions-open={showSuggestions ? "true" : "false"}
        tabIndex={0}
        aria-expanded={showSuggestions}
        aria-label={`${smartDisplayColumns.find((column) => column.key === key)?.label || key}، الصف ${index + 1}`}
        onContextMenu={(event) => openSmartCellMenu(event, index, key)}
        onPointerDown={(event) => {
          if (event.button === 2) return;
          if (event.target.closest?.(".cell-copy-down-button")) return;
          if (editingCell === cellKey) return;
          event.preventDefault();
          selectSmartCell(index, key, event.shiftKey);
        }}
        onDoubleClick={(event) => {
          if (event.target.closest?.(".cell-copy-down-button")) return;
          event.preventDefault();
          beginSmartCellEdit(index, key);
        }}
        onPointerEnter={(event) => {
          if (event.buttons !== 1 || !rangeSelection) return;
          const destination = smartCellPoint(index, key);
          updateSmartSelection((current) =>
            smartSelectionAfterNavigation({
              selection: current,
              destination,
              extendSelection: true,
            }),
          );
        }}
      >
        {multiline ? (
          <SmartMultilineInput
            data-smart-cell={cellKey}
            data-smart-cell-anchor={cellKey}
            data-cell-editing={editingCell === cellKey ? "true" : "false"}
            tabIndex={editingCell === cellKey ? 0 : -1}
            editSessionId={cellEditSessionId}
            value={editorValue}
            {...focusHandlers}
            onDraftChange={(nextValue, event) => {
              rememberSmartCellDraft(
                index,
                key,
                nextValue,
                event.currentTarget,
              );
            }}
            onCommit={(draftValue, _event, sessionId) =>
              commitSmartCellEdit(index, key, draftValue, { sessionId })
            }
            onPaste={(event) => handleSmartPaste(event, index, key)}
            autoComplete="off"
            dir={extra.dir || "auto"}
          />
        ) : (
          <SmartCellTextInput
            {...cellInputProps}
            data-smart-cell={cellKey}
            value={editorValue}
            data-smart-cell-anchor={cellKey}
            data-cell-editing={editingCell === cellKey ? "true" : "false"}
            tabIndex={editingCell === cellKey ? 0 : -1}
            editSessionId={cellEditSessionId}
            {...focusHandlers}
            onDraftChange={(nextValue, event) => {
              delete event.currentTarget.dataset.suggestionDelayUntil;
              rememberSmartCellDraft(
                index,
                key,
                nextValue,
                event.currentTarget,
              );
            }}
            onCommit={(draftValue, _event, sessionId) =>
              commitSmartCellEdit(index, key, draftValue, { sessionId })
            }
            onPaste={(event) => handleSmartPaste(event, index, key)}
            autoComplete="off"
            dir={extra.dir || "auto"}
          />
        )}
        {fieldCopyDownKeys.has(key) && (
          <button
            type="button"
            className="cell-copy-down-button"
            title="نسخ قيمة هذا الحقل إلى الصفوف التالية"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              copyFieldDown(index, key);
            }}
          >
            <ArrowDown size={12} />
          </button>
        )}
        {showSuggestions && suggestionRect && createPortal(
          <div
            className="cell-suggestions"
            data-owner-cell={cellKey}
            style={{
              "--cell-suggestion-top": `${suggestionRect.top}px`,
              "--cell-suggestion-left": `${suggestionRect.left}px`,
              "--cell-suggestion-width": `${suggestionRect.width}px`,
              "--cell-suggestion-max-height": `${suggestionRect.maxHeight || 240}px`,
            }}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
          >
            {shownOptions.map((option, optionIndex) => (
              <button
                key={option}
                type="button"
                className={optionIndex === highlightedSuggestionIndex ? "active" : ""}
                onPointerDown={(event) => {
                  event.preventDefault();
                  applyCellSuggestion(index, key, option, { moveDown: false });
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
              >
                {option}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    );
  };

  const rowSelect = (index, key, children) => (
    <div
      className={`cell-combo copyable-cell${isCellSelected(index, key) ? " selected-cell" : ""}`}
      data-smart-cell-container={`${index}:${key}`}
      tabIndex={0}
      onContextMenu={(event) => openSmartCellMenu(event, index, key)}
      onPointerDown={(event) => {
        if (event.button === 2) return;
        if (event.target.closest?.(".cell-copy-down-button")) return;
        if (editingCell === `${index}:${key}`) return;
        event.preventDefault();
        selectSmartCell(index, key, event.shiftKey);
      }}
      onDoubleClick={(event) => {
        if (event.target.closest?.(".cell-copy-down-button")) return;
        event.preventDefault();
        beginSmartCellEdit(index, key);
      }}
    >
      <select
        data-smart-cell={`${index}:${key}`}
        data-cell-editing={editingCell === `${index}:${key}` ? "true" : "false"}
        tabIndex={editingCell === `${index}:${key}` ? 0 : -1}
        value={rows[index][key] || ""}
        onFocus={() =>
          updateSmartSelection(selectionForCells(index, key))
        }
        onChange={(event) => updateRow(index, key, event.target.value)}
        onBlur={() =>
          updateSmartEditingCell((current) =>
            current === `${index}:${key}` ? "" : current,
          )
        }
      >
        {children}
      </select>
      <button
        type="button"
        className="cell-copy-down-button"
        title="نسخ قيمة هذا الحقل إلى الصفوف التالية"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          copyFieldDown(index, key);
        }}
      >
        <ArrowDown size={12} />
      </button>
    </div>
  );

  function handleSmartViewportScroll(event) {
    const host = event.currentTarget;
    window.cancelAnimationFrame(smartViewportFrameRef.current);
    smartViewportFrameRef.current = window.requestAnimationFrame(() => {
      setSmartViewport((current) => {
        const next = {
          scrollTop: host.scrollTop,
          height: host.clientHeight || current.height,
        };
        return Math.abs(current.scrollTop - next.scrollTop) < 1 &&
          current.height === next.height
          ? current
          : next;
      });
    });
  }

  const virtualizeSmartRows = smartViewRows.length > 200;
  const virtualRowHeight = Math.max(42, rowHeight);
  const virtualOverscan = 8;
  const virtualStart = virtualizeSmartRows
    ? Math.max(
        0,
        Math.floor(smartViewport.scrollTop / virtualRowHeight) -
          virtualOverscan,
      )
    : 0;
  const virtualEnd = virtualizeSmartRows
    ? Math.min(
        smartViewRows.length,
        Math.ceil(
          (smartViewport.scrollTop + smartViewport.height) / virtualRowHeight,
        ) + virtualOverscan,
      )
    : smartViewRows.length;
  const visibleSmartRows = smartViewRows
    .slice(virtualStart, virtualEnd)
    .map((entry, offset) => ({
      row: entry.row,
      index: entry.index,
      displayIndex: virtualStart + offset,
    }));
  const topVirtualSpacerHeight = virtualStart * virtualRowHeight;
  const bottomVirtualSpacerHeight =
    (smartViewRows.length - virtualEnd) * virtualRowHeight;

  return (
    <div className="page-stack">
      <ConfirmationLayer
        dialog={confirmationDialog}
        onResult={settleConfirmation}
      />
      {cellMenu && createPortal(
        <div
          className="smart-cell-context-menu"
          role="menu"
          dir="rtl"
          style={{ left: `${cellMenu.left}px`, top: `${cellMenu.top}px` }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={copySmartCellMenuContent}
          >
            <Copy size={16} /> نسخ المحتوى
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pasteSmartCellMenuContent}
          >
            <ClipboardList size={16} /> لصق
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={clearSmartCellMenuContent}
          >
            <Trash2 size={16} /> مسح
          </button>
        </div>,
        document.body,
      )}
      {rowMenu && createPortal(
        <div
          className="smart-row-context-menu"
          role="menu"
          dir="rtl"
          style={{ left: `${rowMenu.left}px`, top: `${rowMenu.top}px` }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => insertEmptySmartRow(rowMenu.rowId, "above")}
          >
            <Plus size={16} /> إضافة صف فارغ بالأعلى
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => insertEmptySmartRow(rowMenu.rowId, "below")}
          >
            <Plus size={16} /> إضافة صف فارغ بالأسفل
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={deleteSmartRowFromMenu}
          >
            <Trash2 size={16} /> حذف هذا الصف
          </button>
        </div>,
        document.body,
      )}
      {columnMenuColumn && createPortal(
        <div
          className="smart-column-menu"
          role="menu"
          dir="rtl"
          style={{
            left: `${columnMenu.left}px`,
            top: `${columnMenu.top}px`,
            "--smart-column-menu-max-height": `${columnMenu.maxHeight || 520}px`,
          }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="smart-column-menu-head">
            <strong>{columnMenuColumn.label}</strong>
            <button
              type="button"
              className="smart-column-menu-close"
              aria-label="إغلاق"
              onClick={() => setColumnMenu(null)}
            >
              ×
            </button>
          </div>
          <div className="smart-column-menu-section smart-column-menu-sort">
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                applySmartColumnSort(columnMenuColumn.key, "asc")
              }
            >
              <span aria-hidden="true">↑</span>
              {smartColumnType(columnMenuColumn.key) === "number"
                ? "ترتيب من الأصغر إلى الأكبر"
                : "ترتيب من أ إلى ي"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                applySmartColumnSort(columnMenuColumn.key, "desc")
              }
            >
              <span aria-hidden="true">↓</span>
              {smartColumnType(columnMenuColumn.key) === "number"
                ? "ترتيب من الأكبر إلى الأصغر"
                : "ترتيب من ي إلى أ"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => clearSmartColumnSort(columnMenuColumn.key)}
            >
              مسح الترتيب
            </button>
          </div>
          <div className="smart-column-menu-section smart-column-menu-search">
            <input
              type="text"
              value={columnFilterQuery}
              onChange={(event) => setColumnFilterQuery(event.target.value)}
              placeholder="بحث في القيم..."
              autoComplete="off"
            />
            <label className="smart-column-menu-check smart-column-menu-check-all">
              <input
                type="checkbox"
                checked={columnMenuSelectedValues.length === columnMenuOptions.length}
                onChange={(event) => {
                  if (event.target.checked) {
                    selectAllSmartColumnFilter(columnMenuColumn.key);
                  } else {
                    setSmartColumnFilter(columnMenuColumn.key, []);
                  }
                }}
              />
              <span>تحديد الكل</span>
            </label>
            {columnMenuHasBlankValue && (
              <label className="smart-column-menu-check">
                <input
                  type="checkbox"
                  checked={columnMenuSelectedSet.has("")}
                  onChange={() =>
                    toggleSmartColumnFilterValue(columnMenuColumn.key, "")
                  }
                />
                <span>{smartFilterValueLabel("")}</span>
              </label>
            )}
          </div>
          <div className="smart-column-menu-values">
            {shownColumnMenuOptions.map((value) => (
              <label key={value || "__blank__"} className="smart-column-menu-check">
                <input
                  type="checkbox"
                  checked={columnMenuSelectedSet.has(value)}
                  onChange={() =>
                    toggleSmartColumnFilterValue(columnMenuColumn.key, value)
                  }
                />
                <span>{smartFilterValueLabel(value)}</span>
              </label>
            ))}
          </div>
          <div className="smart-column-menu-footer">
            <button
              type="button"
              role="menuitem"
              onClick={() => clearSmartColumnFilter(columnMenuColumn.key)}
            >
              مسح عامل التصفية
            </button>
          </div>
        </div>,
        document.body,
      )}
      <form
        className="panel entry-editor smart-entry"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="panel-head">
          <h2>{isDocumentEdit ? "تعديل مستند" : "إدخال مستند جديد"}</h2>
          {(onCloseContext || onBack) && (
            <button type="button" onClick={handleCloseEditor} title="إغلاق والرجوع">
              <X size={17} /> إغلاق
            </button>
          )}
          <div className="document-id">
            <span>ID</span>
            <strong>
              {entryForm.operation_no || nextDoc?.operation_no || "Auto"}
            </strong>
          </div>
        </div>

        <section className="form-section fixed-data-section">
          <h3>بيانات ثابتة للمستند</h3>
          <div className="form-grid smart-fixed-grid">
            <Field label="نوع المستند">
              <select
                value={entryForm.document_type}
                disabled={!!APP_VARIANT.forcedDocumentType}
                onChange={(event) => changeDocumentType(event.target.value)}
              >
                {DOCUMENT_TYPES.filter((item) =>
                  scopeRole === "contractor"
                    ? item.value === "contractor_certificate"
                    : item.value !== "contractor_certificate",
                ).map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الطرف">
              <select
                value={scopeRole}
                disabled
              >
                <option value={scopeRole}>
                  {scopeRole === "contractor" ? "مقاول" : "عميل"}
                </option>
              </select>
            </Field>
            <Field label="تصنيف العميل">
              <select
                value={entryForm.party_category}
                onChange={(event) =>
                  updateFixed({ party_category: event.target.value })
                }
              >
                <option value="unselected">بدون تصنيف</option>
                <option value="retail">فرد</option>
                <option value="engineer">مهندس</option>
                <option value="corporate">شركة</option>
              </select>
            </Field>
            <ComboField
              label="اسم العميل/المقاول بدون م. أو شركة"
              value={entryForm.base_party_name || ""}
              options={filteredParties.map(
                (party) => party.base_name || party.display_name,
              )}
              onChange={(value) => {
                const existing = filteredParties.find(
                  (party) => (party.base_name || party.display_name) === value,
                );
                updateFixed({
                  base_party_name: value,
                  customer_name: value,
                  party_id: existing?.id || "",
                  party_category:
                    existing?.category || entryForm.party_category,
                  customer_display_name: existing?.display_name || "",
                });
              }}
            />
            {entryForm.document_type === "contractor_certificate" && (
              <ComboField
                label="العميل مصدر الأعمال"
                value={entryForm.source_customer_name || ""}
                options={sourceCustomerOptions}
                onChange={(value) => {
                  const existing = (lookups.customers || []).find(
                    (party) =>
                      (party.base_name || party.display_name) === value ||
                      party.display_name === value,
                  );
                  updateFixed({
                    source_customer_name: value,
                    source_customer_id: existing?.id || "",
                  });
                }}
              />
            )}
            <ComboField
              label="المشروع"
              value={entryForm.project || ""}
              options={projectOptions}
              onChange={(value) =>
                updateFixed({
                  project: value,
                  ...(entryForm.document_type === "contractor_certificate" && !isDocumentEdit
                    ? { certificate_no: "" }
                    : {}),
                })
              }
            />
            {entryForm.document_type === "contractor_certificate" ? (
              <MultiComboField
                label="أنواع الأعمال داخل المستخلص"
                values={selectedWorkTypes}
                options={workTypeOptions.map((value) => ({ value, label: value }))}
                allLabel="اختر أنواع الأعمال"
                multipleLabel="أنواع أعمال"
                clearLabel="مسح الاختيار"
                onChange={(values) =>
                  updateFixed({
                    work_types: values,
                    work_type: values.length === 1 ? values[0] : "",
                  })
                }
              />
            ) : (
              <ComboField
                label="نوع الأعمال"
                value={entryForm.work_type || ""}
                options={workTypeOptions}
                onChange={(value) => updateFixed({ work_type: value })}
              />
            )}
            {entryForm.document_type === "contractor_certificate" && (
              <Field label="رقم المستخلص">
                <div className="certificate-number-field">
                  <input
                    inputMode="numeric"
                    value={entryForm.certificate_no || ""}
                    onChange={(event) => updateFixed({ certificate_no: event.target.value })}
                  />
                  {certificateInfo && (
                    <small>
                      آخر مستخلص لهذا المقاول والمشروع: {certificateInfo.last_no || "لا يوجد"} — التالي: {certificateInfo.next_no}
                    </small>
                  )}
                </div>
              </Field>
            )}
            <Field label="التاريخ">
              <input
                type="date"
                value={dateInputValue(entryForm.entry_date)}
                onChange={(event) =>
                  updateFixed({ entry_date: event.target.value })
                }
              />
            </Field>
            <Field label="رقم المستند">
              <input
                dir="ltr"
                value={entryForm.operation_no || ""}
                placeholder={nextDoc?.operation_no || "Auto"}
                readOnly
                aria-readonly="true"
                title="رقم المستند يُنشأ تلقائياً ولا يمكن تعديله"
              />
            </Field>
            <Field label="الرقم التسلسلي">
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={entryForm.serial || ""}
                placeholder={nextDoc?.next_no || ""}
                readOnly
                aria-readonly="true"
                title="الرقم التسلسلي يُنشأ تلقائياً ولا يمكن تعديله"
              />
            </Field>
            <Field label="الحالة">
              <select
                value={entryForm.document_status || meta.status}
                disabled={!canUser(currentUser, "can_change_status")}
                onChange={(event) =>
                  updateFixed({ document_status: event.target.value })
                }
              >
                <option value="draft">مسودة</option>
                <option value="approved">معتمد</option>
                <option value="closed">مغلق</option>
              </select>
            </Field>
            <Field label="نوع الخصم">
              <select
                value={entryForm.discount_type || "none"}
                onChange={(event) =>
                  updateFixed({ discount_type: event.target.value })
                }
              >
                <option value="none">بدون</option>
                <option value="rate">نسبة</option>
                <option value="amount">مبلغ</option>
              </select>
            </Field>
            <Field label="قيمة الخصم">
              <input
                type="text"
                inputMode="decimal"
                value={entryForm.discount_value || ""}
                onChange={(event) =>
                  updateFixed({ discount_value: event.target.value })
                }
              />
            </Field>
          </div>
        </section>

        <section className="form-section compact-tax-section">
          <h3>الضرائب والتأمينات</h3>
          <div className="tax-grid compact-tax-grid">
            {TAXES.map((tax) => (
              <label key={tax.key} className="check-tile" title={tax.label}>
                <input
                  type="checkbox"
                  checked={!!entryForm[tax.key]}
                  onChange={(event) =>
                    updateFixed({ [tax.key]: event.target.checked })
                  }
                />
                <span>{tax.label}</span>
              </label>
            ))}
            {entryForm.document_type === "price_offer" && (
              <label
                className="check-tile vat-terms-only-tile"
                title="يضيف شرط أن الأسعار شاملة ضريبة 14% إلى التقرير، بدون إضافة الضريبة إلى الحساب"
              >
                <input
                  type="checkbox"
                  checked={!!entryForm.vat_terms_only}
                  onChange={(event) =>
                    updateFixed({ vat_terms_only: event.target.checked })
                  }
                />
                <span>{VAT_TERMS_ONLY_OPTION.label}</span>
              </label>
            )}
          </div>
        </section>

        <section
          className={`form-section smart-table-section${tableExpanded ? " expanded" : ""}`}
        >
          <div className="section-title-row">
            <h3>بنود المستند</h3>
            <div className="section-title-actions">
              <ItemReadyBadge count={rowData.length} />
              <button
                type="button"
                className="icon-button"
                title="لصق بيانات الحافظة في النطاق المحدد"
                aria-label="لصق بيانات الحافظة في النطاق المحدد"
                onClick={pasteIntoCurrentSmartSelection}
              >
                <ClipboardList size={17} />
              </button>
              <button
                type="button"
                className="icon-button expand-table-button"
                title={
                  tableExpanded
                    ? "تصغير جدول البنود"
                    : "توسيع جدول البنود لملء الشاشة"
                }
                onClick={() => setTableExpanded((current) => !current)}
              >
                {tableExpanded ? (
                  <Minimize2 size={17} />
                ) : (
                  <Maximize2 size={17} />
                )}
              </button>
            </div>
          </div>
          {searchOpen && (
            <SmartTableSearchPanel
              initialQuery={searchQuery}
              results={searchResults}
              currentIndex={currentSearchResultIndex}
              columnLabel={smartColumnLabel}
              onSearchChange={setSearchQuery}
              onClose={closeSmartTableSearch}
              onPrevious={() => navigateSmartSearchResults(-1)}
              onNext={() => navigateSmartSearchResults(1)}
              onJump={jumpToSmartSearchResult}
              onReplaceAll={replaceAllSmartSearch}
            />
          )}
          {(smartSort || activeSmartFilterKeys.length > 0) && (
            <div className="smart-table-view-actions">
              <span>
                {smartViewRows.length} صف ظاهر من {rows.length}
              </span>
              <button type="button" onClick={() => setSmartFilters({})}>
                مسح جميع عوامل التصفية
              </button>
              <button type="button" onClick={() => setSmartSort(null)}>
                مسح جميع الترتيبات
              </button>
              <button type="button" onClick={resetSmartTableView}>
                إعادة ضبط العرض
              </button>
            </div>
          )}
          <div
            className="table-scroll smart-table-scroll"
            ref={smartTableScrollRef}
            onScroll={handleSmartViewportScroll}
          >
            <table
              className="smart-entry-table"
              onKeyDown={handleGridKeyDown}
              style={{
                "--smart-row-height": `${rowHeight}px`,
                width: `${smartTableWidth}px`,
                minWidth: `${smartTableWidth}px`,
              }}
            >
              <colgroup>
                {smartDisplayColumns.map((column) => (
                  <col
                    key={column.key}
                    style={{ width: `${resolvedColumnWidth(column)}px` }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {smartDisplayColumns.map((column) => (
                    <th
                      key={column.key}
                      className={
                        [
                          column.key === "__index"
                            ? "smart-row-index-head"
                            : "",
                          column.key === "__actions"
                            ? "smart-row-actions-head"
                            : "",
                          smartSort?.key === column.key ? "is-sorted" : "",
                          Array.isArray(smartFilters[column.key])
                            ? "is-filtered"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      }
                    >
                      <div className="smart-column-head-content">
                        <span>{column.label}</span>
                        {smartSort?.key === column.key && (
                          <span className="smart-column-state">
                            {smartSort.direction === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                        {Array.isArray(smartFilters[column.key]) && (
                          <span className="smart-column-state">🔽</span>
                        )}
                        {!column.key.startsWith("__") && (
                          <button
                            type="button"
                            className="smart-column-menu-button"
                            title={`ترتيب وتصفية عمود ${column.label}`}
                            aria-label={`Sort and filter ${column.label}`}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => openSmartColumnMenu(event, column)}
                          >
                            <ArrowDown size={12} />
                          </button>
                        )}
                      </div>
                      {!column.key.startsWith("__") && (
                        <button
                          type="button"
                          className="column-resize-handle"
                          title={`اسحب لتغيير عرض عمود ${column.label}`}
                          aria-label={`Resize ${column.label} column`}
                          onPointerDown={(event) =>
                            beginColumnResize(column.key, event)
                          }
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topVirtualSpacerHeight > 0 && (
                  <tr
                    className="smart-virtual-spacer"
                    aria-hidden="true"
                  >
                    <td
                      colSpan={smartDisplayColumns.length}
                      style={{ height: `${topVirtualSpacerHeight}px` }}
                    />
                  </tr>
                )}
                {visibleSmartRows.map(({ row, index, displayIndex }) => (
                  <tr
                    key={row._gridId}
                    data-smart-row-index={index}
                    className={[
                      rowHasData(row) ? "" : "ghost-row",
                      fillPreview &&
                      index > fillPreview.sourceIndex &&
                      index <= fillPreview.targetIndex
                        ? "fill-preview-row"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td
                      className="smart-row-index-cell"
                      title="انقر لتحديد الصف بالكامل، واستخدم Shift لتحديد عدة صفوف"
                      onContextMenu={(event) => openSmartRowMenu(event, row)}
                      onPointerDown={(event) => {
                        if (event.button === 2) return;
                        if (event.target.closest?.(".row-resize-handle")) return;
                        event.preventDefault();
                        updateSmartEditingCell("");
                        updateSmartActiveCell("");
                        setSuggestionRect(null);
                        updateSmartSelection((current) => {
                          const currentAnchor = smartCellIndexes(current?.anchorCell);
                          const anchorEntry =
                            event.shiftKey && currentAnchor
                              ? smartViewEntryForIndex(currentAnchor.rowIndex)
                              : null;
                          const anchorRow = anchorEntry?.index ?? index;
                          return selectionForCells(
                            anchorRow,
                            smartCellOrder[0],
                            index,
                            smartCellOrder[smartCellOrder.length - 1],
                          );
                        });
                        focusCellContainer(index, smartCellOrder[0]);
                      }}
                    >
                      <span>{displayIndex + 1}</span>
                      <button
                        type="button"
                        className="row-resize-handle"
                        title="اسحب لتغيير ارتفاع كل الصفوف"
                        onPointerDown={beginRowResize}
                      />
                    </td>
                    {entryForm.document_type === "contractor_certificate" && (
                      <td>{rowInput(index, "work_type")}</td>
                    )}
                    <td>
                      {rowInput(index, "building_unit", {
                        list: "smartBuildings",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "floor_apartment", {
                        list: "smartUnits",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "description", {
                        list: "smartDescriptions",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "glass_spec", { list: "smartGlass" })}
                    </td>
                    <td>
                      {rowInput(index, "profile_spec", {
                        list: "smartProfiles",
                      })}
                    </td>
                    <td>{rowInput(index, "color", { list: "smartColors" })}</td>
                    <td>
                      {rowInput(index, "item_count", {
                        type: "number",
                        step: "0.01",
                        dir: "ltr",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "width_cm", {
                        type: "number",
                        step: "0.01",
                        dir: "ltr",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "height_cm", {
                        type: "number",
                        step: "0.01",
                        dir: "ltr",
                      })}
                    </td>
                    <td>
                      {rowSelect(
                        index,
                        "unit_code",
                        UNITS.map((unit) => (
                          <option key={unit.value} value={unit.value}>
                            {unit.label}
                          </option>
                        )),
                      )}
                    </td>
                    <td>
                      {rowInput(index, "total_quantity", {
                        type: "number",
                        step: "0.01",
                        dir: "ltr",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "rate", {
                        type: "number",
                        step: "0.01",
                        dir: "ltr",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "completion_ratio", {
                        type: "number",
                        step: "0.01",
                        min: "0",
                        max: "100",
                        dir: "ltr",
                        placeholder: "100",
                      })}
                    </td>
                    <td>
                      {rowInput(index, "building_unit_price", {
                        type: "number",
                        step: "0.01",
                        dir: "ltr",
                      })}
                    </td>
                    <td>
                      {rowSelect(
                        index,
                        "measurement_mode",
                        <>
                          <option value="standard">قياسي</option>
                          <option value="engineering">هندسي</option>
                        </>,
                      )}
                    </td>
                    <td className="smart-row-actions-cell">
                      <button
                        type="button"
                        className="icon-button danger copy-spec-down-button"
                        title="نسخ مواصفات الصف للأسفل مع الحفاظ على المقاسات والكميات"
                        onClick={() => copyRowSpecDown(index)}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="نسخ الصف بالكامل إلى نهاية الجدول"
                        onClick={() => copyFullRowToBottom(index)}
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        type="button"
                        className="row-fill-handle"
                        title="اسحب لنسخ الصف للأسفل"
                        onPointerDown={(event) => beginDragFill(index, event)}
                      >
                        <CornerUpLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        title="حذف هذا البند"
                        onClick={() => deleteSmartRow(index)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
                {bottomVirtualSpacerHeight > 0 && (
                  <tr
                    className="smart-virtual-spacer"
                    aria-hidden="true"
                  >
                    <td
                      colSpan={smartDisplayColumns.length}
                      style={{ height: `${bottomVirtualSpacerHeight}px` }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <datalist id="smartBuildings">
            {buildingOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <datalist id="smartUnits">
            {unitOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <datalist id="smartDescriptions">
            {descriptionOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <datalist id="smartGlass">
            {glassOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <datalist id="smartProfiles">
            {profileOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <datalist id="smartColors">
            {colorOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </section>

        <div className="form-actions sticky-actions">
          <button
            type="button"
            className="primary"
            onClick={previewDraft}
            disabled={busy || saving}
          >
            <Eye size={18} /> حفظ ومعاينة
          </button>
          <button
            type="button"
            onClick={submitDraft}
            disabled={busy || saving || !previewData}
          >
            <Save size={18} /> اعتماد وحفظ
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm("مسح نموذج الإدخال الحالي؟")) {
                restoreInputInteractivity();
                return;
              }
              recordSmartHistory();
              const resetEntry = variantEntryDefaults();
              setEntryForm(resetEntry);
              setRows([smartRowFrom(resetEntry)]);
              setPreviewData(null);
              setEntryDirty?.(false);
              restoreInputInteractivity();
            }}
          >
            <Plus size={18} /> مسح النموذج
          </button>
          <ItemReadyBadge count={rowData.length} suffix="بند جاهز للحفظ" />
        </div>
      </form>

      {previewData && (
        <section className="panel linked-report">
          <div className="panel-head">
            <h2>معاينة قبل الحفظ</h2>
            <button type="button" onClick={() => setPreviewData(null)}>
              العودة للتعديل
            </button>
          </div>
          <DocumentPreview data={previewData} readOnly />
        </section>
      )}
    </div>
  );
}

function InlineDocumentEditor({
  api,
  data,
  document,
  party,
  onCloseContext,
  onDeleteRow,
  setMessage,
}) {
  const [rows, setRows] = useState(data.rows || []);
  const initialTaxFlags = TAXES.reduce((flags, tax) => {
    flags[tax.key] = (data.rows || []).some((row) => !!row[tax.key]);
    return flags;
  }, {});
  initialTaxFlags.vat_terms_only = (data.rows || []).some(
    (row) => !!row.vat_terms_only,
  );
  const [main, setMain] = useState({
    operation_no: data.operation_no || "",
    party: data.party || party?.display_name || "",
    project: data.project || document?.project || "",
    building_unit: data.building_unit || document?.building_unit || "",
    work_type: data.overall_work_type || "",
    entry_date: rows[0]?.entry_date || new Date().toISOString().slice(0, 10),
    status: document?.status || rows[0]?.document_status || "draft",
    discount_type: document?.discount_type || rows[0]?.discount_type || "none",
    discount_value: document?.discount_value ?? rows[0]?.discount_value ?? "",
    ...initialTaxFlags,
  });
  const [saving, setSaving] = useState(false);

  function updateRow(id, patch) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  async function saveMain() {
    setSaving(true);
    try {
      const taxPatch = TAXES.reduce((patch, tax) => {
        patch[tax.key] = main[tax.key] ? 1 : 0;
        return patch;
      }, {});
      taxPatch.vat_terms_only = main.vat_terms_only ? 1 : 0;
      const documentPatch = {
        project: main.project,
        building_unit: main.building_unit,
        status: main.status,
        discount_type: main.discount_type || "none",
        discount_value: Number(main.discount_value || 0),
      };
      if (document?.id) {
        await api.request(`/api/documents/${document.id}`, {
          method: "PUT",
          body: JSON.stringify(documentPatch),
        });
      }
      const savedRows = await Promise.all(
        rows.map((row) =>
          api.request(`/api/entries/${row.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...row,
              ...taxPatch,
              customer_name: main.party,
              customer_display_name: main.party,
              project: main.project,
              building_unit: row.building_unit || main.building_unit,
              work_type: main.work_type,
              entry_date: main.entry_date,
              document_status: main.status,
              discount_type: documentPatch.discount_type,
              discount_value: documentPatch.discount_value,
            }),
          }),
        ),
      );
      setRows(savedRows);
      setMessage("تم حفظ بيانات المستند الرئيسية.");
    } catch (error) {
      setMessage(`تعذر حفظ بيانات المستند: ${error.message}`);
    } finally {
      setSaving(false);
      restoreInputInteractivity();
    }
  }

  async function saveRow(row) {
    setSaving(true);
    try {
      const saved = await api.request(`/api/entries/${row.id}`, {
        method: "PUT",
        body: JSON.stringify(row),
      });
      updateRow(row.id, saved);
      setMessage("تم حفظ البند.");
    } catch (error) {
      setMessage(`تعذر حفظ البند: ${error.message}`);
    } finally {
      setSaving(false);
      restoreInputInteractivity();
    }
  }

  async function deleteInlineRow(row) {
    try {
      await onDeleteRow(row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } finally {
      restoreInputInteractivity();
    }
  }

  return (
    <div className="page-stack">
      <section className="panel inline-document-editor">
        <div className="panel-head">
          <h2>تعديل المستند</h2>
          <button type="button" onClick={onCloseContext}>
            اغلاق التقرير
          </button>
        </div>
        <div className="form-grid">
          <Field label="ID">
            <input value={main.operation_no} readOnly />
          </Field>
          <Field label="العميل">
            <input
              value={main.party}
              onChange={(event) =>
                setMain({ ...main, party: event.target.value })
              }
            />
          </Field>
          <Field label="التاريخ">
            <input
              type="date"
              value={dateInputValue(main.entry_date)}
              onChange={(event) =>
                setMain({ ...main, entry_date: event.target.value })
              }
            />
          </Field>
          <Field label="المشروع">
            <input
              value={main.project}
              onChange={(event) =>
                setMain({ ...main, project: event.target.value })
              }
            />
          </Field>
          <Field label="المبنى / الوحدة الافتراضية">
            <input
              value={main.building_unit}
              onChange={(event) =>
                setMain({ ...main, building_unit: event.target.value })
              }
            />
          </Field>
          <Field label="نوع الأعمال">
            <input
              value={main.work_type}
              onChange={(event) =>
                setMain({ ...main, work_type: event.target.value })
              }
            />
          </Field>
          <Field label="الحالة">
            <select
              value={main.status}
              onChange={(event) =>
                setMain({ ...main, status: event.target.value })
              }
            >
              <option value="draft">مسودة</option>
              <option value="approved">معتمد</option>
              <option value="closed">مغلق</option>
            </select>
          </Field>
          <Field label="نوع الخصم">
            <select
              value={main.discount_type || "none"}
              onChange={(event) =>
                setMain({ ...main, discount_type: event.target.value })
              }
            >
              <option value="none">بدون</option>
              <option value="rate">نسبة</option>
              <option value="amount">مبلغ</option>
            </select>
          </Field>
          <Field label="قيمة الخصم">
            <input
              type="text"
              inputMode="decimal"
              value={main.discount_value || ""}
              onChange={(event) =>
                setMain({ ...main, discount_value: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="tax-grid compact-tax-grid inline-tax-grid">
          {TAXES.map((tax) => (
            <label key={tax.key} className="check-tile" title={tax.label}>
              <input
                type="checkbox"
                checked={!!main[tax.key]}
                onChange={(event) =>
                  setMain({ ...main, [tax.key]: event.target.checked })
                }
              />
              <span>{tax.label}</span>
            </label>
          ))}
          {(document?.document_type === "price_offer" || data.type === "offer") && (
            <label
              className="check-tile vat-terms-only-tile"
              title="يضيف شرط أن الأسعار شاملة ضريبة 14% إلى التقرير، بدون إضافة الضريبة إلى الحساب"
            >
              <input
                type="checkbox"
                checked={!!main.vat_terms_only}
                onChange={(event) =>
                  setMain({ ...main, vat_terms_only: event.target.checked })
                }
              />
              <span>{VAT_TERMS_ONLY_OPTION.label}</span>
            </label>
          )}
        </div>
        <div className="form-actions">
          <button
            className="primary"
            type="button"
            onClick={saveMain}
            disabled={saving}
          >
            <Save size={18} /> حفظ بيانات المستند
          </button>
        </div>
      </section>

      <section className="panel inline-rows">
        <div className="panel-head">
          <h2>بنود المستند</h2>
        </div>
        <div className="table-scroll report-table inline-table">
          <table>
            <thead>
              <tr>
                <th>الموقع</th>
                <th>البيان</th>
                <th>زجاج</th>
                <th>قطاع</th>
                <th>لون</th>
                <th>عدد</th>
                <th>عرض سم</th>
                <th>ارتفاع سم</th>
                <th>كمية مباشرة</th>
                <th>فئة</th>
                <th>نسبة العمل %</th>
                <th>الإجمالي</th>
                <th>الصافي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      dir="auto"
                      value={row.building_unit || ""}
                      onChange={(event) =>
                        updateRow(row.id, { building_unit: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <textarea
                      dir="auto"
                      value={row.description || ""}
                      onChange={(event) =>
                        updateRow(row.id, { description: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <textarea
                      dir="auto"
                      value={row.glass_spec || ""}
                      onChange={(event) =>
                        updateRow(row.id, { glass_spec: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <textarea
                      dir="auto"
                      value={row.profile_spec || ""}
                      onChange={(event) =>
                        updateRow(row.id, { profile_spec: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <textarea
                      dir="auto"
                      value={row.color || ""}
                      onChange={(event) =>
                        updateRow(row.id, { color: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.item_count || ""}
                      onChange={(event) =>
                        updateRow(row.id, { item_count: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.width_cm || ""}
                      onChange={(event) =>
                        updateRow(row.id, { width_cm: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.height_cm || ""}
                      onChange={(event) =>
                        updateRow(row.id, { height_cm: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.total_quantity || ""}
                      onChange={(event) =>
                        updateRow(row.id, {
                          total_quantity: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.rate || ""}
                      onChange={(event) =>
                        updateRow(row.id, { rate: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      value={row.completion_ratio || ""}
                      placeholder="100"
                      onChange={(event) =>
                        updateRow(row.id, {
                          completion_ratio: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td>{money(row.gross_total)}</td>
                  <td>{money(row.net_total)}</td>
                  <td className="row-actions">
                    <button
                      className="icon-button"
                      title="حفظ"
                      onClick={() => saveRow(row)}
                      disabled={saving}
                    >
                      <Save size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      title="حذف"
                      onClick={() => deleteInlineRow(row)}
                      disabled={saving}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function previewQuantityParts(rows = []) {
  const totals = { sqm: 0, lm: 0, count: 0 };
  for (const row of rows || []) {
    const unit = normalizeClientUnitCode(row.unit_code || row.unit);
    totals[unit] += num(row.quantity);
  }
  return [
    totals.sqm
      ? { value: money(totals.sqm), unit: "م²" }
      : null,
    totals.lm
      ? { value: money(totals.lm), unit: "م.ط" }
      : null,
    totals.count
      ? { prefix: "بالعدد", value: money(totals.count), unit: "" }
      : null,
  ].filter(Boolean);
}

function previewItemCount(rows = []) {
  return (rows || []).reduce((total, row) => {
    const unit = normalizeClientUnitCode(row.unit_code || row.unit);
    return unit === "sqm" || unit === "lm"
      ? total + num(row.item_count)
      : total;
  }, 0);
}

function ReportTotalCard({
  label,
  subLabel = "",
  value,
  monetary = true,
  unit = "",
  parts = null,
  className = "",
}) {
  const valueParts = Array.isArray(parts)
    ? parts
    : [{ value: monetary ? formatMonetaryTotal(value) : value, unit }];
  return (
    <span
      className={`report-total-card${className ? ` ${className}` : ""}`}
      dir="rtl"
    >
      <span className="report-total-card__label">
        {label}
        {subLabel && (
          <em className="preview-sub-label">({subLabel})</em>
        )}
      </span>
      <strong className="report-total-card__value">
        {valueParts.map((part, index) => (
          <React.Fragment
            key={`${part.prefix || ""}-${part.value}-${part.unit || ""}-${index}`}
          >
            {index > 0 && (
              <span className="report-total-value-separator" aria-hidden="true">
                -
              </span>
            )}
            <span className="report-total-value-part">
              {part.prefix && (
                <span className="report-total-prefix" dir="rtl">
                  {part.prefix}
                </span>
              )}
              <bdi dir="ltr">{part.value}</bdi>
              {part.unit && (
                <span className="report-total-unit" dir="rtl">
                  {part.unit}
                </span>
              )}
            </span>
          </React.Fragment>
        ))}
      </strong>
    </span>
  );
}

function DocumentPreview({
  data,
  onEditRow,
  onDeleteRow,
  onClose,
  compact = false,
  dimensionUnit = "cm",
  readOnly = false,
}) {
  if (!data) {
    return <div className="empty-state"> </div>;
  }
  const rows = data.rows || [];
  const statementRows = data.statementRows || [];
  const paymentRows = data.paymentRows || [];
  const showDimensions =
    (data.show_dimensions || reportHasDimensions(rows)) &&
    !statementRows.length;
  const showCompletion =
    ["invoice", "taxInvoice", "nonTaxInvoice", "contractor"].includes(
      data.type,
    ) ||
    statementRows.some(
      (row) =>
        !row.is_payment && (row.completion_percent || row.completion_ratio),
    );
  const showVatInclusiveRate =
    ["offer", "price_offer"].includes(data.type) &&
    (!!data.vat_enabled || rows.some((row) => !!row.vat_enabled));
  const realGrossTotal = Number(
    data.totals?.real_gross_total || data.totals?.real_debit || 0,
  );
  const workGrossTotal = Number(
    data.totals?.gross_total || data.totals?.debit || 0,
  );
  const hasWorkRateTotal =
    realGrossTotal > 0 &&
    roundMoney(realGrossTotal) !== roundMoney(workGrossTotal);
  const taxBreakdown = data.tax_breakdown || [];
  const hasTax = taxBreakdown.some((tax) => Number(tax.amount || 0));
  const hasDiscount =
    !!data.discount_label || Number(data.totals?.discount_amount || 0) !== 0;
  const hasTaxOrDiscount =
    hasTax || hasDiscount;
  const beforeAdjustmentLabel = hasTax && hasDiscount
    ? "قبل الخصم والضريبة"
    : hasTax
      ? "قبل الضريبة"
      : hasDiscount
        ? "قبل الخصم"
        : "";
  const afterAdjustmentLabel = hasTax && hasDiscount
    ? "بعد الخصم والضريبة"
    : hasTax
      ? "بعد الضريبة"
      : hasDiscount
        ? "بعد الخصم"
        : "";
  const hasPayments = statementRows.length > 0 || paymentRows.length > 0;
  const showContractorProjectColumn =
    data.type === "contractor" && Number(data.project_selection_count || 0) !== 1;
  const moneyOrBlank = (value) =>
    Number(value || 0) ? money(value) : "";
  const quantityParts = previewQuantityParts(rows);
  const itemCountTotal = previewItemCount(rows);
  const reportBlocks = buildReportRowBlocks(rows, data.subtotal_mode || "none");
  const previewBranding = data.branding || {};
  const itemTableColumnCount =
    9 +
    (showContractorProjectColumn ? 1 : 0) +
    (showDimensions ? 1 : 0) +
    (showCompletion ? 2 : 0) +
    (!readOnly ? 1 : 0);
  const subtotalLabelColSpan =
    4 + (showContractorProjectColumn ? 1 : 0) + (showDimensions ? 1 : 0);
  const previewProject = reportProjectHeading(data.project, rows, data);
  return (
    <div
      className="document-preview"
      style={{
        "--preview-brand-color": previewBranding.companyNameColor || "var(--accent)",
        "--preview-line-color": previewBranding.lineColor || "var(--line)",
        "--preview-head-bg": previewBranding.tableHeaderBg || "var(--surface-2)",
        "--preview-head-text": previewBranding.tableHeaderText || "var(--text)",
      }}
    >
      <div className="doc-head">
        <div>
          <img
            src={previewBranding.logoDataUri || appLogo}
            alt={previewBranding.companyNameEn || APP_NAME}
          />
          {(previewBranding.companyNameEn || previewBranding.companyNameAr) && (
            <div className="preview-company-name">
              <strong>{previewBranding.companyNameEn}</strong>
              <span>{previewBranding.companyNameAr}</span>
            </div>
          )}
          <h2>{data.title}</h2>
          <p>
            {text(data.party)} / {text(previewProject)}
          </p>
        </div>
        <div className="doc-meta">
          <strong>{text(data.operation_no || data.serial)}</strong>
          <span>{new Date(data.generated_at).toLocaleDateString("en-GB")}</span>
          {!readOnly && <button type="button" className="preview-close-btn" onClick={onClose} title="إغلاق">إغلاق</button>}
        </div>
      </div>

      <div className="totals report-totals-container">
        <div className="totals-row totals-primary">
          {!statementRows.length && quantityParts.length > 0 && (
            <ReportTotalCard
              label="الكمية"
              parts={quantityParts}
              monetary={false}
            />
          )}
          {!statementRows.length && itemCountTotal > 0 && (
            <ReportTotalCard
              label="العدد"
              value={money(itemCountTotal)}
              monetary={false}
            />
          )}
          {statementRows.length && data.totals?.quantity ? (
            <ReportTotalCard
              label="الكمية"
              value={money(data.totals.quantity)}
              monetary={false}
            />
          ) : null}
          {hasWorkRateTotal ? (
            <>
              <ReportTotalCard label="قبل نسبة العمل" value={realGrossTotal} />
              <ReportTotalCard label="بعد نسبة العمل" value={workGrossTotal} />
            </>
          ) : hasTaxOrDiscount || hasPayments ? (
            <ReportTotalCard
              label="الإجمالي"
              subLabel={hasTaxOrDiscount ? beforeAdjustmentLabel : ""}
              value={data.totals?.gross_total || data.totals?.debit}
            />
          ) : (
            <ReportTotalCard
              label="الصافي"
              value={data.totals?.net_total}
              className="emphasis"
            />
          )}
        </div>
        {(hasTaxOrDiscount || hasPayments) && (
          <div className="totals-row totals-secondary">
            {taxBreakdown.map((tax) => (
              <ReportTotalCard
                key={tax.key || tax.label}
                label={tax.label}
                value={tax.amount}
              />
            ))}
            {data.discount_label && (
              <ReportTotalCard
                label={data.discount_label}
                value={data.totals?.discount_amount}
                className="discount"
              />
            )}
            {hasPayments &&
              hasTaxOrDiscount &&
              Number(data.totals?.credit || 0) !== 0 && (
                <ReportTotalCard
                  label="الإجمالي"
                  subLabel={afterAdjustmentLabel}
                  value={
                    Number(data.totals?.net_total || 0) +
                    Number(data.totals?.credit || 0)
                  }
                />
              )}
            {hasPayments && (
              <ReportTotalCard label="التحصيل" value={data.totals?.credit} />
            )}
            <ReportTotalCard
              label={
                hasPayments
                  ? data.type === "contractor"
                    ? "إجمالي المستحق"
                    : "الرصيد"
                  : "الإجمالي"
              }
              subLabel={
                hasTaxOrDiscount && !hasPayments ? afterAdjustmentLabel : ""
              }
              value={data.totals?.net_total}
              className="emphasis"
            />
          </div>
        )}
      </div>

      {data.summaryRows?.length > 0 && <SummaryTable rows={data.summaryRows} />}
      {statementRows.length > 0 && (
        <div
          className={
            compact
              ? "table-scroll report-table compact-table"
              : "table-scroll report-table"
          }
        >
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستند</th>
                <th>المشروع</th>
                <th className="details-cell">التفاصيل</th>
                <th>الكمية</th>
                {showCompletion && <th>نسبة العمل</th>}
                <th>خصم</th>
                {showCompletion && <th>قبل النسبة</th>}
                <th>الإجمالي</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {statementRows.map((row, index) => (
                <tr
                  key={`${row.document_id || row.operation_no || index}-${row.is_payment ? "payment" : "debit"}-${index}`}
                  className={row.is_payment ? "payment-row" : ""}
                >
                  <td>{text(row.entry_date)}</td>
                  <td className="statement-doc">{text(row.description)}</td>
                  <td>
                    {text(
                      row.project_label ||
                        row.project ||
                        "",
                    )}
                  </td>
                  <td className="details-cell">{text(row.details)}</td>
                  <td>{row.is_payment ? "" : moneyOrBlank(row.quantity)}</td>
                  {showCompletion && (
                    <td className="work-rate-cell">
                      {row.is_payment
                        ? ""
                        : text(formatCompletionPercent(row))}
                    </td>
                  )}
                  <td className="discount-cell">
                    {row.is_payment ? "" : moneyOrBlank(row.discount_amount)}
                  </td>
                  {showCompletion && (
                    <td>
                      {row.is_payment
                        ? ""
                        : moneyOrBlank(row.real_debit || row.debit)}
                    </td>
                  )}
                  <td>{moneyOrBlank(row.statement_total ?? (row.is_payment ? row.credit : row.debit))}</td>
                  <td className={Number(row.balance || 0) < 0 ? "negative-balance" : ""}>{money(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paymentRows.length > 0 && (
        <div
          className={
            compact
              ? "table-scroll report-table compact-table"
              : "table-scroll report-table"
          }
        >
          <table>
            <thead>
              <tr>
                <th>تاريخ الدفعة</th>
                <th>بيان الأعمال</th>
                <th>بيان الدفعة</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((row, index) => (
                <tr key={`${row.id || index}-payment`} className="payment-row">
                  <td>{text(row.entry_date)}</td>
                  <td>{text(row.work_type || row.description || "تحصيل")}</td>
                  <td>{text(row.collection_note || row.notes)}</td>
                  <td>{money(paymentRowAmount(row))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!statementRows.length && rows.length > 0 ? (
        <div
          className={
            compact
              ? "table-scroll report-table compact-table"
              : "table-scroll report-table"
          }
        >
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الأعمال</th>
                <th>البيان</th>
                {showContractorProjectColumn && <th>المشروع</th>}
                {showDimensions && <th>المقاس</th>}
                <th>الوحدة</th>
                <th>العدد</th>
                <th>الكمية</th>
                {showCompletion && <th>نسبة العمل</th>}
                <th>الفئة</th>
                <th>الإجمالي</th>
                {showCompletion && <th>بعد النسبة</th>}
                <th>الصافي</th>
                {!readOnly && <th></th>}
              </tr>
            </thead>
            <tbody>
              {reportBlocks.map((block, index) => {
                if (block.type === "heading") {
                  return (
                    <tr
                      key={`heading-${block.level}-${block.label}-${index}`}
                      className={`report-group-row ${block.level}-group-row`}
                    >
                      <td colSpan={itemTableColumnCount}>{text(block.label)}</td>
                    </tr>
                  );
                }
                if (block.type === "subtotal") {
                  const totals = block.totals || {};
                  return (
                    <tr
                      key={`subtotal-${block.level}-${block.label}-${index}`}
                      className={`report-subtotal-row ${block.level}-subtotal-row`}
                    >
                      <td colSpan={subtotalLabelColSpan}>إجمالي {text(block.label)}</td>
                      <td>{moneyOrBlank(totals.item_count)}</td>
                      <td>{money(totals.quantity)}</td>
                      {showCompletion && <td></td>}
                      <td></td>
                      <td>{money(totals.gross_total)}</td>
                      {showCompletion && <td>{money(totals.work_gross_total)}</td>}
                      <td>{money(totals.net_total)}</td>
                      {!readOnly && <td></td>}
                    </tr>
                  );
                }
                const row = block.row;
                return (
                  <tr key={row.id || `row-${index}`}>
                    <td>{text(row.entry_date)}</td>
                    <td>{text(row.work_type)}</td>
                    <td className="desc-cell">{statementOf(row)}</td>
                    {showContractorProjectColumn && (
                      <td>{text(cleanProjectName(row.project))}</td>
                    )}
                    {showDimensions && (
                      <td className="nowrap dimension-cell">{rowDimension(row, dimensionUnit)}</td>
                    )}
                    <td>
                      {text(
                        row.unit_code ? rowUnitLabel(row.unit_code) : row.unit,
                      )}
                    </td>
                    <td>
                      {moneyOrBlank(row.item_count)}
                    </td>
                    <td>{money(row.quantity)}</td>
                    {showCompletion && (
                      <td className="work-rate-cell">
                        {text(formatCompletionPercent(row) || "")}
                      </td>
                    )}
                    <td className="preview-rate-cell">
                      <span>{money(row.rate)}</span>
                      {showVatInclusiveRate && Number(row.rate || 0) !== 0 && (
                        <small className="preview-vat-rate" dir="ltr">
                          ({money(Number(row.rate || 0) * 1.14)}) <em>VAT</em>
                        </small>
                      )}
                    </td>
                    <td>{money(row.gross_total)}</td>
                    {showCompletion && (
                      <td>{money(row.work_gross_total || row.gross_total)}</td>
                    )}
                    <td>{money(row.net_total)}</td>
                    {!readOnly && (
                      <td className="row-actions">
                        <button
                          className="icon-button"
                          title="تعديل"
                          onClick={() => onEditRow(row)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button danger"
                          title="حذف"
                          onClick={() => onDeleteRow(row.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !statementRows.length && (
          <div className="empty-state">لا توجد بيانات</div>
        )
      )}
    </div>
  );
}

function SummaryTable({ rows }) {
  const keys = Object.keys(rows[0] || {});
  return (
    <div className="table-scroll compact-table">
      <table>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key}>{summaryLabel(key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {keys.map((key) => (
                <td key={key}>
                  {typeof row[key] === "number"
                    ? money(row[key])
                    : text(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManagerEventCenter({ events = [], onAction }) {
  return (
    <section className="panel manager-event-center">
      <details open={events.length > 0}>
        <summary>
          <span>
            <Bell size={18} /> التنبيهات والعروض
          </span>
          <strong>{events.length}</strong>
        </summary>
        <div className="manager-event-list">
          {!events.length && (
            <div className="empty-state">لا توجد تنبيهات نشطة حالياً.</div>
          )}
          {events.map((event) => {
            const style = event.style || {};
            return (
              <article
                key={event.id}
                className={`manager-event-card ${event.event_type}${event.seen ? " seen" : ""}`}
                style={{
                  backgroundColor: style.backgroundColor || style.background || undefined,
                  color: style.color || style.textColor || undefined,
                  borderColor: style.borderColor || style.accentColor || undefined,
                }}
              >
                <div className="manager-event-card-head">
                  <span>{event.event_type === "offer" ? "عرض" : event.event_type === "warning" ? "تحذير" : "معلومة"}</span>
                  <small>{event.created_at ? formatUserDateTime(event.created_at) : ""}</small>
                </div>
                <h3>{event.title}</h3>
                <p>{event.message}</p>
                {event.event_type === "offer" &&
                  (event.offer_price || event.offer_details) && (
                    <div className="manager-offer-details">
                      {event.offer_price && <strong>{event.offer_price}</strong>}
                      {event.offer_details && <span>{event.offer_details}</span>}
                    </div>
                  )}
                <div className="manager-event-actions">
                  {!event.seen && (
                    <button type="button" onClick={() => onAction?.(event.id, "seen")}>
                      <Check size={16} /> تمت القراءة
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => onAction?.(event.id, "dismiss")}
                  >
                    <X size={16} /> إخفاء
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </details>
    </section>
  );
}

function SettingsView({
  api,
  currentUser,
  apiBase,
  setApiBase,
  themeMode,
  setThemeMode,
  health,
  bootstrap,
  terms,
  setTerms,
  reportBranding,
  setReportBranding,
  subscriptionPlans,
  setSubscriptionPlans,
  setSubscriptionState,
  createBackup,
  setMessage,
  busy,
  updateInfo,
  checkingUpdate,
  checkForUpdates,
  openUpdateDownload,
  subscriptionOnly = false,
  managerEvents = [],
  onManagerEventAction,
}) {
  const [password, setPassword] = useState("");
  const [retailTerms, setRetailTerms] = useState(
    terms.terms_retail || { sections: [] },
  );
  const [corporateTerms, setCorporateTerms] = useState(
    terms.terms_corporate || { sections: [] },
  );
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({
    username: "",
    display_name: "",
    password: "",
    role: "user",
    can_create_invoices: 0,
    can_create_payments: 0,
    can_change_status: 0,
    can_edit_terms: 0,
    can_edit_company_settings: 0,
    can_edit_table_styles: 0,
  });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUser, setEditingUser] = useState({});
  const [passwordDraft, setPasswordDraft] = useState({
    current_password: "",
    new_password: "",
  });
  const [adminPasswordDraft, setAdminPasswordDraft] = useState("");
  const [serverDraft, setServerDraft] = useState(() =>
    normalizeServerConfigDraft({}, apiBase),
  );
  const [serverStatus, setServerStatus] = useState(null);
  const [serverStatusLoading, setServerStatusLoading] = useState(false);
  const [serverStatusExpanded, setServerStatusExpanded] = useState(true);
  const [serverBusy, setServerBusy] = useState(false);
  const [desktopSettings, setDesktopSettings] = useState(null);
  const [desktopSettingsBusy, setDesktopSettingsBusy] = useState(false);
  const [companyProfileDraft, setCompanyProfileDraft] = useState(
    bootstrap?.company || {
      company_name: "",
      contact_name: "",
      email: "yasserdiabhassan@gmail.com",
      phone: "",
      address: "Cairo, Egypt",
      website: "",
    },
  );
  const [brandingDraft, setBrandingDraft] = useState(
    reportBranding || {
      companyNameEn: APP_NAME,
      companyNameAr: APP_NAME,
      companyAbbreviation: APP_MARK,
      website: "",
      companyAddress: "Cairo, Egypt",
      companyPhone: "",
      footerContactMode: "website",
      companyNameColor: "#146b5c",
      lineColor: "#89d8ce",
      tableHeaderBg: "#1a2d31",
      tableHeaderText: "#d9f7f2",
      tableBodyText: "#1b1b1b",
      tableOddBg: "#faf8f2",
      tableEvenBg: "#ffffff",
      qrColor: "#111111",
      qrBackground: "#ffffff",
      showAddressInDateBlock: false,
      headingFontFamily: "georgia",
      bodyFontFamily: "arial",
      logoDataUri: "",
    },
  );
  const [logoDragging, setLogoDragging] = useState(false);
  const [managerSubscriptionConfig, setManagerSubscriptionConfig] = useState(null);
  const [managerSubscriptionLoading, setManagerSubscriptionLoading] = useState(false);
  const [managerSubscriptionError, setManagerSubscriptionError] = useState("");
  const [managerBillingCycle, setManagerBillingCycle] = useState("monthly");
  const [managerPaymentMode, setManagerPaymentMode] = useState("recurring");
  const [selectedManagerPlanId, setSelectedManagerPlanId] = useState("");
  const [managerCheckoutLoading, setManagerCheckoutLoading] = useState(false);
  const [managerCheckoutError, setManagerCheckoutError] = useState("");
  const [managerSyncing, setManagerSyncing] = useState(false);
  const [managerCanceling, setManagerCanceling] = useState(false);
  const [managerDeletingAccount, setManagerDeletingAccount] = useState(false);
  const [managerDeletePhrase, setManagerDeletePhrase] = useState("");
  const [managerSubscriptionStatus, setManagerSubscriptionStatus] = useState(null);
  const [managerPayments, setManagerPayments] = useState([]);
  const managerPaypalButtonsRef = useRef(null);
  const managerPaypalCardRef = useRef(null);
  const managerPaypalCardSubmitRef = useRef(null);
  const managerCheckoutRenderIdRef = useRef(0);
  const isCompanyAdmin = ["admin", "manager"].includes(currentUser?.role);
  const adminUnlocked = isCompanyAdmin || password === "23320001";
  const canEditCompanySettings = canUser(currentUser, "can_edit_company_settings");
  const canEditTerms = canUser(currentUser, "can_edit_terms");
  const canEditTableStyles = canUser(currentUser, "can_edit_table_styles");
  const canEditServerSettings = canEditCompanySettings || adminUnlocked;
  const activeConnectionMode =
    desktopSettings?.connectionMode ||
    localStorage.getItem("priceOfferConnectionMode") ||
    window.priceOfferDesktop?.connectionMode ||
    (isLoopbackApiBase(apiBase) ? "local" : "remote");
  const isRemoteServerConnection = activeConnectionMode === "remote";
  const dashboardSummary = bootstrap?.summary || {};
  const documentStatuses = bootstrap?.docs || [];
  const managerSubscriptionPlans = useMemo(
    () => managerSubscriptionConfig?.plans || [],
    [managerSubscriptionConfig],
  );
  const selectedManagerPlan =
    managerSubscriptionPlans.find((plan) => plan.id === selectedManagerPlanId) ||
    managerSubscriptionPlans[0] ||
    null;
  const managerCheckoutAmount = managerPlanPrice(selectedManagerPlan);
  const managerCurrency =
    selectedManagerPlan?.currency ||
    managerSubscriptionConfig?.paypal?.currency ||
    "USD";
  const activeManagerSubscription = managerSubscriptionStatus?.subscription || null;
  const managerSubscriptionCancelsAtPeriodEnd =
    !!managerSubscriptionStatus?.cancel_at_period_end ||
    (!!activeManagerSubscription?.canceled_at && managerSubscriptionStatus?.has_access);
  const managerPaidThroughAt =
    managerSubscriptionStatus?.paid_through_at || activeManagerSubscription?.renews_at || "";
  const managerPaidThroughLabel = managerPaidThroughAt
    ? new Date(managerPaidThroughAt).toLocaleDateString("en-GB")
    : "";
  const managerCanCancelSubscription =
    !!activeManagerSubscription &&
    !!managerSubscriptionStatus?.has_access &&
    !managerSubscriptionCancelsAtPeriodEnd;

  useEffect(() => {
    let cancelled = false;
    window.priceOfferDesktop?.getDesktopSettings?.()
      .then((settings) => {
        if (!cancelled) setDesktopSettings(settings);
      })
      .catch(() => {});
    const unsubscribe = window.priceOfferDesktop?.onDesktopSettingsChanged?.(
      (settings) => {
        if (!cancelled) setDesktopSettings(settings);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  async function updateDesktopSetting(key, value) {
    if (!window.priceOfferDesktop?.updateDesktopSettings) return;
    setDesktopSettingsBusy(true);
    try {
      const settings = await window.priceOfferDesktop.updateDesktopSettings({
        [key]: value,
      });
      setDesktopSettings(settings);
      setMessage("تم حفظ إعدادات تشغيل التطبيق.", { type: "success" });
    } catch (error) {
      setMessage(`تعذر حفظ إعدادات تشغيل التطبيق: ${error.message}`);
    } finally {
      setDesktopSettingsBusy(false);
    }
  }

  async function chooseReportSaveDirectory() {
    const picked = await window.priceOfferDesktop?.chooseDirectory?.();
    if (!picked) return;
    await updateDesktopSetting("reportSaveDirectory", picked);
    setMessage(`تم تعيين مجلد حفظ التقارير: ${picked}`, {
      type: "success",
    });
  }

  function updateBranding(key, value) {
    setBrandingDraft((current) => ({ ...current, [key]: value }));
  }

  function updateServerDraft(key, value) {
    setServerDraft((current) => ({ ...current, [key]: value }));
  }

  const loadServerConfig = useCallback(async () => {
    try {
      const data = await api.request("/api/admin/server-config");
      setServerDraft((current) => {
        const next = normalizeServerConfigDraft(data, apiBase);
        return {
          ...next,
          migrateFromDbPath: current.migrateFromDbPath || "",
          migrateToDbPath: current.migrateToDbPath || next.dbPath,
        };
      });
    } catch (error) {
      setMessage(`تعذر تحميل إعدادات السيرفر: ${error.message}`);
    }
  }, [api, apiBase, setMessage]);

  const refreshServerStatus = useCallback(
    async (notify = false) => {
      setServerStatusLoading(true);
      try {
        let data;
        if (isRemoteServerConnection) {
          if (window.priceOfferDesktop?.getConnectionStatus) {
            data = await window.priceOfferDesktop.getConnectionStatus(apiBase);
          } else {
            const connected = !!(await probeApiBase(apiBase));
            data = {
              ok: connected,
              connected,
              serverUrl: apiBase,
              text: [
                "Accounting Management client connection status",
                `Generated: ${new Date().toISOString()}`,
                "Connection mode: REMOTE SERVER / TUNNEL",
                `Configured server: ${apiBase}`,
                "Pinned server: Yes (no automatic local-server fallback)",
                `API health: ${connected ? "Connected" : "Unavailable"}`,
                "Database: Managed by the remote server; no local database path is required.",
                "PowerShell diagnostics are available in the Windows desktop app.",
              ].join("\n"),
            };
          }
        } else {
          data = await api.request("/api/admin/server-status");
        }
        setServerStatus(data);
        if (notify) setMessage("تم تحديث حالة السيرفر.", { type: "success" });
      } catch (error) {
        setServerStatus({
          text: `Could not read server status: ${error.message}`,
        });
        if (notify) setMessage(`تعذر قراءة حالة السيرفر: ${error.message}`);
      } finally {
        setServerStatusLoading(false);
      }
    },
    [api, apiBase, isRemoteServerConnection, setMessage],
  );

  async function chooseServerDirectory() {
    const picked = await window.priceOfferDesktop?.chooseDirectory?.();
    if (picked) updateServerDraft("dataDir", picked);
  }

  async function chooseDatabaseFile(key = "dbPath") {
    const picked = await window.priceOfferDesktop?.chooseDatabaseFile?.();
    if (picked) updateServerDraft(key, picked);
  }

  async function saveServerConfig(event) {
    event?.preventDefault?.();
    if (!isRemoteServerConnection && !canEditServerSettings) {
      setMessage("هذا المستخدم غير مسموح له بتعديل إعدادات السيرفر.");
      return;
    }
    setServerBusy(true);
    try {
      if (isRemoteServerConnection) {
        const remoteUrl = cleanApiBase(serverDraft.serverUrl || apiBase);
        if (!remoteUrl) throw new Error("أدخل رابط السيرفر أو التنل.");
        setApiBase(remoteUrl, { connectionMode: "remote" });
        updateServerDraft("serverUrl", remoteUrl);
        setMessage(`تم تثبيت اتصال هذا الجهاز على ${remoteUrl}`, {
          type: "success",
        });
        await refreshServerStatus();
        return;
      }
      const data = await api.request("/api/admin/server-config", {
        method: "PUT",
        body: JSON.stringify({
          requester_user_id: currentUser?.id,
          password,
          dataDir: serverDraft.dataDir,
          dbPath: serverDraft.dbPath,
          databaseProvider: serverDraft.databaseProvider,
          remoteDatabaseUrl: serverDraft.remoteDatabaseUrl,
        }),
      });
      let restartedServer = null;
      if (data.restartRequired && window.priceOfferDesktop?.startLocalServer) {
        restartedServer = await window.priceOfferDesktop.startLocalServer({
          dataDir: serverDraft.dataDir,
          dbPath: serverDraft.dbPath,
          restart: true,
        });
        const nextServer = cleanApiBase(
          restartedServer.localUrl || restartedServer.serverUrl || "",
        );
        if (nextServer) setApiBase(nextServer, { connectionMode: "local" });
      }
      await loadServerConfig();
      setMessage(
        restartedServer
          ? `تم تبديل قاعدة البيانات وتشغيل السيرفر: ${restartedServer.dbPath}`
          : data.restartRequired
            ? "تم حفظ المسارات. أعد تشغيل السيرفر أو التطبيق لتطبيق قاعدة البيانات/المجلد الجديد."
          : "تم حفظ مسارات السيرفر.",
        { type: restartedServer || !data.restartRequired ? "success" : "warning" },
      );
    } catch (error) {
      setMessage(`تعذر حفظ مسارات السيرفر: ${error.message}`);
    } finally {
      setServerBusy(false);
    }
  }

  async function startHosting() {
    if (!canEditServerSettings) {
      setMessage("هذا المستخدم غير مسموح له بتشغيل الاستضافة.");
      return;
    }
    setServerBusy(true);
    try {
      const data = await api.request("/api/admin/start-hosting", {
        method: "POST",
        body: JSON.stringify({
          requester_user_id: currentUser?.id,
          password,
        }),
      });
      const nextServer = cleanApiBase(data.serverUrl || data.localUrl || "");
      if (nextServer) {
        updateServerDraft("serverUrl", nextServer);
        setApiBase(nextServer, { connectionMode: "local" });
      }
      setServerStatus((current) => ({
        ...(current || {}),
        text: [
          data.message,
          `Server URL: ${data.serverUrl || ""}`,
          ...(data.lanUrls || []).map((url) => `LAN: ${url}`),
          `Data folder: ${data.dataDir || ""}`,
          `Database file: ${data.dbPath || ""}`,
          data.needsInternetSetup || "",
        ]
          .filter(Boolean)
          .join("\n"),
      }));
      setMessage(data.message || "تم تشغيل الاستضافة.", { type: "success" });
      await refreshServerStatus();
    } catch (error) {
      setMessage(`تعذر تشغيل الاستضافة: ${error.message}`);
    } finally {
      setServerBusy(false);
    }
  }

  async function migrateDatabase() {
    if (!canEditServerSettings) {
      setMessage("هذا المستخدم غير مسموح له بترحيل قاعدة البيانات.");
      return;
    }
    if (!serverDraft.migrateFromDbPath || !serverDraft.migrateToDbPath) {
      setMessage("اختر قاعدة البيانات المصدر والهدف أولاً.");
      return;
    }
    setServerBusy(true);
    try {
      const data = await api.request("/api/admin/migrate-database", {
        method: "POST",
        body: JSON.stringify({
          requester_user_id: currentUser?.id,
          password,
          fromDbPath: serverDraft.migrateFromDbPath,
          toDbPath: serverDraft.migrateToDbPath,
        }),
      });
      setMessage(data.message || "تم ترحيل قاعدة البيانات.", {
        type: "success",
      });
      await refreshServerStatus();
    } catch (error) {
      setMessage(`تعذر ترحيل قاعدة البيانات: ${error.message}`);
    } finally {
      setServerBusy(false);
    }
  }

  async function copyServerStatus() {
    const text = serverStatus?.text || "";
    if (!text) return;
    if (await copyTextToClipboard(text)) {
      setMessage("تم نسخ حالة السيرفر.", { type: "success" });
    } else {
      setMessage("تعذر النسخ من المتصفح، النص ظاهر ويمكن تحديده يدوياً.");
    }
  }

  function managerPlanPrice(plan, billingCycle = managerBillingCycle) {
    if (!plan) return 0;
    const amount =
      billingCycle === "annually"
        ? plan.annually ?? plan.annual ?? plan.yearly ?? plan.monthly
        : plan.monthly ?? plan.amount ?? plan.price;
    return Number(amount || 0);
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve("");
      if (!String(file.type || "").startsWith("image/")) {
        reject(new Error("Please choose an image file."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(reader.error || new Error("Could not read image."));
      reader.readAsDataURL(file);
    });
  }

  async function applyLogoFile(file) {
    try {
      const dataUrl = await readImageFile(file);
      if (dataUrl) updateBranding("logoDataUri", dataUrl);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveBranding(event) {
    event.preventDefault();
    if (!canEditTableStyles) {
      setMessage("هذا المستخدم غير مسموح له بتعديل استايلات الجداول.");
      return;
    }
    try {
      const data = await api.request("/api/settings/report-branding", {
        method: "PUT",
        body: JSON.stringify({
          password,
          requester_user_id: currentUser?.id,
          branding: brandingDraft,
        }),
      });
      setReportBranding?.(data);
      setMessage("Report branding saved.");
    } catch (error) {
      setMessage(`Could not save report branding: ${error.message}`);
    }
  }

  const refreshManagerSubscriptionConfig = useCallback(async () => {
    setManagerSubscriptionLoading(true);
    setManagerSubscriptionError("");
    try {
      const data = await loadManagerSubscriptionConfig(apiBase);
      setManagerSubscriptionConfig(data);
      setSelectedManagerPlanId((current) => {
        if (current && data.plans?.some((plan) => plan.id === current)) return current;
        return data.plans?.[0]?.id || "";
      });
    } catch (error) {
      setManagerSubscriptionConfig(null);
      setManagerSubscriptionError(
        "Manager subscription settings are not available right now.",
      );
    } finally {
      setManagerSubscriptionLoading(false);
    }
  }, [apiBase]);

  const refreshManagerState = useCallback(async () => {
    const [statusResult, paymentsResult] = await Promise.allSettled([
      loadManagerSubscriptionStatus(apiBase),
      loadManagerPayments(apiBase),
    ]);
    if (statusResult.status === "fulfilled") {
      setManagerSubscriptionStatus(statusResult.value);
      setManagerSubscriptionError("");
    } else {
      setManagerSubscriptionStatus(null);
      setManagerSubscriptionError(
        managerClientErrorMessage(statusResult.reason),
      );
    }
    if (paymentsResult.status === "fulfilled") {
      setManagerPayments(paymentsResult.value?.payments || []);
    }
  }, [
    apiBase,
    companyProfileDraft.company_name,
    companyProfileDraft.contact_name,
    companyProfileDraft.email,
    companyProfileDraft.phone,
    currentUser?.display_name,
    currentUser?.username,
  ]);

  async function refreshLocalSubscriptionState() {
    const status = await api.request("/api/subscription/status").catch(() => null);
    if (!status) return null;
    setSubscriptionState?.({
      ...status,
      can_use_app: status.can_use_app !== false && status.has_access !== false,
    });
    return status;
  }

  async function syncManagerNow() {
    setManagerSyncing(true);
    try {
      setManagerSubscriptionError("");
      const [config, status, payments] = await Promise.all([
        loadManagerSubscriptionConfig(apiBase),
        loadManagerSubscriptionStatus(apiBase),
        loadManagerPayments(apiBase).catch(() => ({ payments: [] })),
      ]);
      setManagerSubscriptionConfig(config);
      setManagerSubscriptionStatus(status);
      setManagerPayments(payments?.payments || []);
      setSelectedManagerPlanId((current) => {
        if (current && config.plans?.some((plan) => plan.id === current)) {
          return current;
        }
        return config.plans?.[0]?.id || "";
      });
      await refreshLocalSubscriptionState();
      setMessage("تم تحديث بيانات Manager من السيرفر المحلي.", { type: "success" });
    } catch (error) {
      setManagerSubscriptionStatus(null);
      const message = managerClientErrorMessage(error);
      setManagerSubscriptionError(message);
      setMessage(`لم تتم المزامنة مع Manager: ${message}`, {
        type: "error",
      });
    } finally {
      setManagerSyncing(false);
    }
  }

  async function cancelManagerSubscription() {
    if (
      !window.confirm(
        "Cancel subscription renewal? Access stays active until the current paid period ends, then support and subscription access stop.",
      )
    ) {
      return;
    }
    setManagerCanceling(true);
    try {
      const result = await api.request("/api/subscription/cancel", {
        method: "POST",
        body: JSON.stringify({
          requester_user_id: currentUser?.id,
          reason: "Canceled from Accounting Management settings.",
        }),
      });
      if (result.status) setManagerSubscriptionStatus(result.status);
      await refreshManagerState();
      setMessage("Subscription renewal canceled. Paid access remains until the period ends.");
    } catch (error) {
      setMessage(`Could not cancel subscription: ${error.message}`, { type: "error" });
    } finally {
      setManagerCanceling(false);
    }
  }

  async function deleteManagerAccount() {
    if (!adminUnlocked || managerDeletePhrase !== "DELETE") return;
    if (
      !window.confirm(
        "Delete this company account permanently? A backup copy of the database will be created first, then the working app data, saved users, chat, documents, payments, and local subscription records will be removed. Support and subscription access may be lost.",
      )
    ) {
      return;
    }
    setManagerDeletingAccount(true);
    try {
      const result = await api.request("/api/company-account", {
        method: "DELETE",
        body: JSON.stringify({
          requester_user_id: currentUser?.id,
          password,
          confirmation: managerDeletePhrase,
        }),
      });
      setManagerSubscriptionStatus(null);
      setManagerPayments([]);
      setManagerDeletePhrase("");
      localStorage.removeItem("priceOfferUser");
      setMessage(
        `Company account deleted. Database archive: ${result.archivePath || result.archiveDir || "created in data folder"}`,
        { type: "warning", sticky: true },
      );
      window.setTimeout(() => window.location.reload(), 1600);
    } catch (error) {
      setMessage(`Could not delete company account: ${error.message}`, {
        type: "error",
      });
    } finally {
      setManagerDeletingAccount(false);
    }
  }

  useEffect(() => {
    refreshManagerSubscriptionConfig();
    refreshManagerState().catch(() => null);
  }, [refreshManagerState, refreshManagerSubscriptionConfig]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = null;
    const renderId = managerCheckoutRenderIdRef.current + 1;
    managerCheckoutRenderIdRef.current = renderId;
    const buttonsContainer = managerPaypalButtonsRef.current;
    const cardContainer = managerPaypalCardRef.current;
    const cardSubmitButton = managerPaypalCardSubmitRef.current;
    if (!buttonsContainer) return undefined;
    buttonsContainer.replaceChildren();
    cardContainer?.replaceChildren();
    if (cardSubmitButton) cardSubmitButton.hidden = true;
    if (!hasManagerClientPack()) {
      setManagerCheckoutError("");
      setManagerCheckoutLoading(false);
      return undefined;
    }
    if (!selectedManagerPlan) return undefined;

    async function mountPayPal() {
      setManagerCheckoutLoading(true);
      setManagerCheckoutError("");
      try {
        const nextCleanup = await renderManagerPayPalCheckout({
          apiBase,
          buttonsContainer,
          cardContainer,
          cardSubmitButton,
          plan: selectedManagerPlan,
          billingCycle: managerBillingCycle,
          amount: managerCheckoutAmount,
          currency: managerCurrency,
          buttonColor: themeMode === "gold" ? "gold" : "blue",
          paymentMode: managerPaymentMode,
          account: {
            name: companyProfileDraft.company_name,
            owner_email: companyProfileDraft.email,
            owner_phone: companyProfileDraft.phone,
          },
          app: {
            name: APP_NAME,
            version: APP_VERSION,
            release_label: `v${APP_DISPLAY_VERSION}`,
          },
          customer: {
            user_id: currentUser?.id,
            user_name: currentUser?.username || currentUser?.display_name || "",
            company_name: companyProfileDraft.company_name,
            email: companyProfileDraft.email,
            phone: companyProfileDraft.phone,
          },
          onApproved: async () => {
            if (cancelled) return;
            try {
              await refreshManagerSubscriptionConfig();
              await refreshManagerState();
              await refreshLocalSubscriptionState();
              setMessage(
                managerPaymentMode === "recurring"
                  ? "Recurring PayPal subscription activated and sent to the manager."
                  : "PayPal payment completed and sent to the manager.",
              );
            } finally {
              restoreInputInteractivity();
            }
          },
          onError: (error) => {
            if (!cancelled) {
              setManagerCheckoutError(error?.message || "PayPal checkout failed.");
              restoreInputInteractivity();
            }
          },
          isCancelled: () =>
            cancelled || managerCheckoutRenderIdRef.current !== renderId,
        });
        if (cancelled) {
          nextCleanup?.();
        } else {
          cleanup = nextCleanup;
        }
      } catch (error) {
        if (
          !cancelled &&
          !String(error?.message || "").includes("PayPal checkout was replaced")
        )
          setManagerCheckoutError(error.message || "Could not render PayPal checkout.");
      } finally {
        if (!cancelled) setManagerCheckoutLoading(false);
      }
    }

    mountPayPal();
    return () => {
      cancelled = true;
      cleanup?.();
      restoreInputInteractivity();
    };
  }, [
    api,
    apiBase,
    companyProfileDraft.company_name,
    companyProfileDraft.email,
    companyProfileDraft.phone,
    currentUser?.display_name,
    currentUser?.id,
    currentUser?.username,
    managerBillingCycle,
    managerCheckoutAmount,
    managerPaymentMode,
    managerCurrency,
    refreshManagerState,
    refreshManagerSubscriptionConfig,
    selectedManagerPlan,
    setMessage,
    themeMode,
  ]);
  useEffect(() => {
    setRetailTerms(terms.terms_retail || { sections: [] });
    setCorporateTerms(terms.terms_corporate || { sections: [] });
  }, [terms]);
  useEffect(() => {
    if (reportBranding) setBrandingDraft(reportBranding);
  }, [reportBranding]);
  useEffect(() => {
    loadServerConfig();
    refreshServerStatus();
  }, [loadServerConfig, refreshServerStatus]);
  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      try {
        const rows = await api.request("/api/users");
        if (!cancelled) setUsers(rows || []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    }
    loadUsers();
    const timer = isCompanyAdmin ? window.setInterval(loadUsers, 30000) : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [api, currentUser?.role, isCompanyAdmin]);

  useEffect(() => {
    if (bootstrap?.company) setCompanyProfileDraft(bootstrap.company);
  }, [bootstrap?.company]);

  async function saveCompanyProfile(event) {
    event.preventDefault();
    if (!canEditCompanySettings) {
      setMessage("Company profile changes are available for managers only.");
      return;
    }
    try {
      const profile = await api.request("/api/company/profile", {
        method: "PUT",
        body: JSON.stringify({
          ...companyProfileDraft,
          requester_user_id: currentUser?.id,
          password,
        }),
      });
      setCompanyProfileDraft(profile);
      const branding = await api.request("/api/settings/report-branding").catch(() => null);
      if (branding) {
        setReportBranding?.(branding);
        setBrandingDraft(branding);
      }
      setMessage("Company profile saved.");
    } catch (error) {
      setMessage(`Could not save company profile: ${error.message}`);
    }
  }

  async function saveTerms(key, value) {
    if (!canEditTerms) {
      setMessage("هذا المستخدم غير مسموح له بتعديل الشروط والأحكام.");
      return;
    }
    try {
      await api.request(`/api/settings/terms/${key}`, {
        method: "PUT",
        body: JSON.stringify({ password, requester_user_id: currentUser?.id, value }),
      });
      setTerms((current) => ({
        ...current,
        [key === "corporate" ? "terms_corporate" : "terms_retail"]: value,
      }));
      setMessage("تم حفظ الشروط والأحكام.");
    } catch (error) {
      setMessage(`لم يتم حفظ الشروط: ${error.message}`);
    }
  }

  async function addUser(event) {
    event.preventDefault();
    try {
      const user = await api.request("/api/users", {
        method: "POST",
        body: JSON.stringify({
          ...newUser,
          requester_user_id: currentUser?.id,
          password: newUser.password,
        }),
      });
      setUsers((current) => [...current, user]);
      setNewUser({
        username: "",
        display_name: "",
        password: "",
        role: "user",
        can_create_invoices: 0,
        can_create_payments: 0,
        can_change_status: 0,
        can_edit_terms: 0,
        can_edit_company_settings: 0,
        can_edit_table_styles: 0,
      });
      setMessage("تم إضافة المستخدم.");
    } catch (error) {
      setMessage(`تعذر إضافة المستخدم: ${error.message}`);
    }
  }

  async function saveUser(userId) {
    try {
      const updated = await api.request(`/api/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...editingUser,
          requester_user_id: currentUser?.id,
        }),
      });
      setUsers((current) =>
        current.map((user) =>
          user.id === userId ? { ...user, ...updated } : user,
        ),
      );
      setEditingUserId(null);
      setEditingUser({});
      setMessage("تم تعديل المستخدم.");
    } catch (error) {
      setMessage(`تعذر تعديل المستخدم: ${error.message}`);
    }
  }

  async function deleteUser(userId) {
    if (!window.confirm("إيقاف هذا المستخدم؟")) return;
    try {
      await api.request(`/api/users/${userId}`, {
        method: "DELETE",
        body: JSON.stringify({ requester_user_id: currentUser?.id, password }),
      });
      setUsers((current) => current.filter((user) => user.id !== userId));
      setMessage("تم إيقاف المستخدم.");
    } catch (error) {
      setMessage(`تعذر إيقاف المستخدم: ${error.message}`);
    }
  }

  async function changeMyPassword(event) {
    event.preventDefault();
    try {
      await api.request(`/api/users/${currentUser.id}/password`, {
        method: "PUT",
        body: JSON.stringify({
          ...passwordDraft,
          requester_user_id: currentUser?.id,
        }),
      });
      setPasswordDraft({ current_password: "", new_password: "" });
      setMessage("تم تغيير كلمة المرور.");
    } catch (error) {
      setMessage(`تعذر تغيير كلمة المرور: ${error.message}`);
    }
  }

  return (
    <div
      className={
        subscriptionOnly
          ? "page-stack settings-subscription-only"
          : "page-stack"
      }
    >
      <ManagerEventCenter
        events={managerEvents}
        onAction={onManagerEventAction}
      />
      <section className="panel application-version-panel">
        <div className="panel-head">
          <h2>
            <RefreshCw size={18} /> إصدار التطبيق والتحديثات
          </h2>
        </div>
        <div className="facts application-version-facts">
          <span>
            الإصدار المثبت: <strong dir="ltr">v{String(APP_VERSION).replace(/^v/i, "")}</strong>
          </span>
          <span>
            أحدث إصدار متاح:{" "}
            <strong dir="ltr">{updateInfo?.latestVersion || (checkingUpdate ? "..." : "—")}</strong>
          </span>
          <span>
            إصدار قاعدة البيانات:{" "}
            <strong dir="ltr">{health?.databaseSchemaVersion ?? "—"}</strong>
          </span>
        </div>
        <div className="action-row">
          <button
            type="button"
            onClick={() => checkForUpdates?.(false)}
            disabled={checkingUpdate || updateInfo?.status === "downloading"}
          >
            <RefreshCw size={16} className={checkingUpdate ? "animate-spin" : ""} />
            {checkingUpdate ? "جارٍ فحص التحديثات" : "فحص التحديثات"}
          </button>
          {(updateInfo?.updateAvailable || updateInfo?.canInstall) && (
            <button
              type="button"
              className="primary"
              onClick={openUpdateDownload}
              disabled={updateInfo?.status === "downloading"}
            >
              {updateInfo?.canInstall
                ? "إعادة التشغيل والتثبيت"
                : updateInfo?.status === "downloading"
                  ? `جارٍ التنزيل ${Math.round(updateInfo.downloadPercent || 0)}%`
                  : "تنزيل التحديث"}
            </button>
          )}
        </div>
        {updateInfo?.status === "current" && (
          <p className="muted">التطبيق محدّث.</p>
        )}
        {updateInfo?.error && <p className="error-text">{updateInfo.error}</p>}
      </section>
      {desktopSettings && (
        <section className="panel report-save-settings-panel">
          <div className="panel-head">
            <h2>
              <FileDown size={18} /> حفظ التقارير
            </h2>
          </div>
          <div className="form-grid report-save-settings-grid">
            <Field label="مجلد حفظ التقارير الافتراضي">
              <div className="path-input-row">
                <input
                  dir="ltr"
                  value={desktopSettings.reportSaveDirectory || ""}
                  placeholder="اتركه فارغاً لاختيار المجلد عند كل حفظ"
                  disabled={desktopSettingsBusy}
                  onChange={(event) =>
                    setDesktopSettings((current) => ({
                      ...(current || {}),
                      reportSaveDirectory: event.target.value,
                    }))
                  }
                  onBlur={(event) =>
                    updateDesktopSetting("reportSaveDirectory", event.target.value)
                  }
                />
                <button
                  type="button"
                  onClick={chooseReportSaveDirectory}
                  disabled={desktopSettingsBusy}
                >
                  <HardDrive size={16} /> اختيار
                </button>
                {!!desktopSettings.reportSaveDirectory && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => updateDesktopSetting("reportSaveDirectory", "")}
                    disabled={desktopSettingsBusy}
                  >
                    استخدام نافذة الحفظ
                  </button>
                )}
              </div>
            </Field>
            <label className="settings-check-row">
              <input
                type="checkbox"
                checked={!!desktopSettings.openPdfAfterSaving}
                disabled={desktopSettingsBusy}
                onChange={(event) =>
                  updateDesktopSetting("openPdfAfterSaving", event.target.checked)
                }
              />
              <span>فتح PDF تلقائياً بعد الحفظ للمراجعة</span>
            </label>
            {!desktopSettings.reportSaveDirectory &&
              desktopSettings.lastReportSaveDirectory && (
                <small dir="ltr">
                  Last used folder: {desktopSettings.lastReportSaveDirectory}
                </small>
              )}
          </div>
        </section>
      )}
      <section className="panel settings-grid">
        <div className="server-settings-panel">
          <div className="panel-head">
            <h2>
              <Server size={18} /> الخادم
            </h2>
            <button
              type="button"
              className="ghost"
              onClick={() => refreshServerStatus(true)}
              disabled={serverStatusLoading}
            >
              <RefreshCw size={16} /> تحديث
            </button>
          </div>
          <form className="form-grid server-control-grid" onSubmit={saveServerConfig}>
            <Field label="Server URL">
              <input
                dir="ltr"
                value={serverDraft.serverUrl || ""}
                onChange={(event) => updateServerDraft("serverUrl", event.target.value)}
                onBlur={(event) => {
                  const clean = cleanApiBase(event.target.value);
                  if (clean) {
                    const sameServer = clean === cleanApiBase(apiBase);
                    setApiBase(clean, {
                      connectionMode: sameServer
                        ? activeConnectionMode
                        : connectionModeForApiBase(clean),
                    });
                  }
                }}
                list="settings-server-url-candidates"
              />
              <datalist id="settings-server-url-candidates">
                {apiBaseCandidates(serverDraft.serverUrl).map((candidate) => (
                  <option key={candidate} value={candidate} />
                ))}
              </datalist>
            </Field>
            {desktopSettings && (
              <div className="desktop-server-options">
                {!isRemoteServerConnection && (
                  <label>
                    <input
                      type="checkbox"
                      checked={desktopSettings.startServerOnLaunch !== false}
                      disabled={desktopSettingsBusy}
                      onChange={(event) =>
                        updateDesktopSetting("startServerOnLaunch", event.target.checked)
                      }
                    />
                    <span>Start the local server automatically when this desktop app opens</span>
                  </label>
                )}
                <label className={desktopSettings.supportsOpenAtLogin ? "" : "disabled"}>
                  <input
                    type="checkbox"
                    checked={!!desktopSettings.openAtLogin}
                    disabled={
                      desktopSettingsBusy || !desktopSettings.supportsOpenAtLogin
                    }
                    onChange={(event) =>
                      updateDesktopSetting("openAtLogin", event.target.checked)
                    }
                  />
                  <span>
                    {desktopSettings.supportsOpenAtLogin
                      ? "Open the app when Windows starts"
                      : "System sign-in startup is not available here"}
                  </span>
                </label>
              </div>
            )}
            {isRemoteServerConnection ? (
              <div className="remote-server-connection-card">
                <strong>Remote server / tunnel mode</strong>
                <span dir="ltr">{serverDraft.serverUrl || apiBase}</span>
                <p>
                  This computer remains pinned to this address. Database folders and
                  database files are managed by the remote host and are not required here.
                </p>
                <button
                  type="submit"
                  className="primary"
                  disabled={serverBusy}
                >
                  <Save size={17} /> Save and pin this connection
                </button>
              </div>
            ) : (
              <>
            <Field label="Data folder">
              <div className="server-path-row">
                <input
                  dir="ltr"
                  value={serverDraft.dataDir || ""}
                  onChange={(event) => updateServerDraft("dataDir", event.target.value)}
                />
                <button
                  type="button"
                  onClick={chooseServerDirectory}
                  disabled={!window.priceOfferDesktop?.chooseDirectory}
                >
                  Browse <HardDrive size={16} />
                </button>
              </div>
            </Field>
            <Field label="Database file">
              <div className="server-path-row">
                <input
                  dir="ltr"
                  value={serverDraft.dbPath || ""}
                  onChange={(event) => updateServerDraft("dbPath", event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => chooseDatabaseFile("dbPath")}
                  disabled={!window.priceOfferDesktop?.chooseDatabaseFile}
                >
                  Browse <Database size={16} />
                </button>
              </div>
            </Field>
            <Field label="Migrate from old database">
              <div className="server-path-row">
                <input
                  dir="ltr"
                  value={serverDraft.migrateFromDbPath || ""}
                  onChange={(event) =>
                    updateServerDraft("migrateFromDbPath", event.target.value)
                  }
                />
                <button
                  type="button"
                  onClick={() => chooseDatabaseFile("migrateFromDbPath")}
                  disabled={!window.priceOfferDesktop?.chooseDatabaseFile}
                >
                  Browse <Database size={16} />
                </button>
              </div>
            </Field>
            <Field label="Migrate to new database">
              <div className="server-path-row">
                <input
                  dir="ltr"
                  value={serverDraft.migrateToDbPath || ""}
                  onChange={(event) =>
                    updateServerDraft("migrateToDbPath", event.target.value)
                  }
                />
                <button
                  type="button"
                  onClick={() => chooseDatabaseFile("migrateToDbPath")}
                  disabled={!window.priceOfferDesktop?.chooseDatabaseFile}
                >
                  Browse <Database size={16} />
                </button>
              </div>
            </Field>
            <Field label="Remote database URL">
              <input
                dir="ltr"
                value={serverDraft.remoteDatabaseUrl || ""}
                onChange={(event) =>
                  updateServerDraft("remoteDatabaseUrl", event.target.value)
                }
              />
            </Field>
            <Field label="Database provider">
              <select
                value={serverDraft.databaseProvider || "local"}
                onChange={(event) =>
                  updateServerDraft("databaseProvider", event.target.value)
                }
              >
                <option value="local">Local SQLite</option>
                <option value="remote">Remote URL / tunnel</option>
              </select>
            </Field>
            <div className="action-row server-actions">
              <button
                type="button"
                onClick={startHosting}
                disabled={serverBusy || !canEditServerSettings}
              >
                <Server size={17} /> تشغيل الاستضافة
              </button>
              <button type="button" onClick={createBackup} disabled={busy}>
                <Database size={17} /> نسخة احتياطية
              </button>
            </div>
            <div className="action-row server-admin-actions">
              <button
                type="submit"
                className="primary"
                title="Save selected data/database paths"
                disabled={serverBusy || !canEditServerSettings}
              >
                <Save size={17} /> Save paths
              </button>
              <button
                type="button"
                onClick={migrateDatabase}
                title="Copy data from an old database file into the selected new database file"
                disabled={serverBusy || !canEditServerSettings}
              >
                <Database size={17} /> Migrate DB
              </button>
            </div>
              </>
            )}
          </form>
          <div className="server-process-panel">
            <div className="server-process-head">
              <button
                type="button"
                className="server-process-toggle"
                onClick={() => setServerStatusExpanded((value) => !value)}
                title={serverStatusExpanded ? "Collapse" : "Expand"}
              >
                {serverStatusExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <span>
                {isRemoteServerConnection
                  ? "Tunnel client connection details"
                  : "Server process details"}
              </span>
              <button
                type="button"
                className="server-process-copy"
                onClick={copyServerStatus}
                title="Copy server status"
              >
                <Copy size={16} />
              </button>
            </div>
            {serverStatusExpanded && (
              <pre dir="ltr">
                {serverStatusLoading
                  ? "Reading PowerShell status..."
                  : serverStatus?.text || "No server process messages yet."}
              </pre>
            )}
          </div>
          <div className="facts server-facts">
            {!isRemoteServerConnection && (
              <>
                <span>
                  <HardDrive size={16} /> {serverDraft.activeDataDir || serverDraft.dataDir || "-"}
                </span>
                <span>
                  <Database size={16} /> {serverDraft.activeDbPath || serverDraft.dbPath || "-"}
                </span>
              </>
            )}
            <span>
              <Smartphone size={16} /> {serverDraft.serverUrl || apiBase}
            </span>
            {!isRemoteServerConnection && (serverStatus?.lanUrls || serverDraft.lanIps || []).map((url) => (
              <span key={url}>
                <Smartphone size={16} /> {url}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="panel-head">
            <h2>المظهر</h2>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={themeMode === "system" ? "active" : ""}
              onClick={() => setThemeMode("system")}
            >
              <Monitor size={17} /> النظام
            </button>
            <button
              type="button"
              className={themeMode === "light" ? "active" : ""}
              onClick={() => setThemeMode("light")}
            >
              <Sun size={17} /> فاتح
            </button>
            <button
              type="button"
              className={themeMode === "dark" ? "active" : ""}
              onClick={() => setThemeMode("dark")}
            >
              <Moon size={17} /> داكن
            </button>
            <button
              type="button"
              className={themeMode === "gold" ? "active" : ""}
              onClick={() => setThemeMode("gold")}
            >
              <Activity size={17} /> ذهبي
            </button>
          </div>
          <Field label="كلمة مرور الإدارة">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <span className={adminUnlocked ? "unlock ok" : "unlock"}>
            {adminUnlocked ? "تم فتح أدوات الإدارة" : "أدوات الإدارة مقفلة"}
          </span>
          {isCompanyAdmin && (
            <form
              className="admin-password-form"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await api.request("/api/settings/admin-password", {
                    method: "PUT",
                    body: JSON.stringify({
                      requester_user_id: currentUser?.id,
                      password,
                      new_password: adminPasswordDraft,
                    }),
                  });
                  setAdminPasswordDraft("");
                  setMessage("Company admin password saved.");
                } catch (error) {
                  setMessage(`Could not save admin password: ${error.message}`);
                }
              }}
            >
              <Field label="New company admin password">
                <input
                  type="password"
                  value={adminPasswordDraft}
                  onChange={(event) => setAdminPasswordDraft(event.target.value)}
                  required
                />
              </Field>
              <button type="submit" disabled={!adminPasswordDraft}>
                <KeyRound size={18} /> Save admin password
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="panel commercial-settings">
        <div className="panel-head">
          <h2>
            <Building2 size={18} /> Company profile
          </h2>
          <span className="user-chip">{canEditCompanySettings ? "Manager" : "Locked"}</span>
        </div>
        {canEditCompanySettings ? (
          <form className="form-grid company-profile-form" onSubmit={saveCompanyProfile}>
            {[
              ["company_name", "Company name"],
              ["contact_name", "Manager / contact name"],
              ["email", "Contact email"],
              ["phone", "Contact phone"],
              ["website", "Company website"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  dir={key === "email" || key === "website" || key === "phone" ? "ltr" : "auto"}
                  value={companyProfileDraft[key] || ""}
                  onChange={(event) =>
                    setCompanyProfileDraft((current) => ({
                      ...(current || {}),
                      [key]: event.target.value,
                    }))
                  }
                />
              </Field>
            ))}
            <Field label="Company address">
              <textarea
                value={companyProfileDraft.address || ""}
                onChange={(event) =>
                  setCompanyProfileDraft((current) => ({
                    ...(current || {}),
                    address: event.target.value,
                  }))
                }
              />
            </Field>
            <button type="submit" className="primary">
              <Save size={18} /> Save company profile
            </button>
          </form>
        ) : (
          <div className="empty-state">Company profile is available for managers only.</div>
        )}
      </section>

      <section className="panel commercial-settings">
        <div className="panel-head">
          <h2>
            <FileText size={18} /> Report branding
          </h2>
          <span className="user-chip">{canEditTableStyles ? "Company admin" : "Locked"}</span>
        </div>
        {canEditTableStyles ? (
          <form className="form-grid branding-form" onSubmit={saveBranding}>
            <div
              className={logoDragging ? "logo-drop dragging" : "logo-drop"}
              onDragOver={(event) => {
                event.preventDefault();
                setLogoDragging(true);
              }}
              onDragLeave={() => setLogoDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setLogoDragging(false);
                applyLogoFile(event.dataTransfer.files?.[0]);
              }}
            >
              {brandingDraft.logoDataUri ? (
                <img src={brandingDraft.logoDataUri} alt="Report logo" />
              ) : (
                <span>Drop logo image</span>
              )}
              <label className="logo-file-button">
                <Paperclip size={16} /> Choose image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => applyLogoFile(event.target.files?.[0])}
                />
              </label>
            </div>
            <Field label="Company name EN">
              <input
                value={brandingDraft.companyNameEn || ""}
                onChange={(event) => updateBranding("companyNameEn", event.target.value)}
              />
            </Field>
            <Field label="Company name AR">
              <input
                value={brandingDraft.companyNameAr || ""}
                onChange={(event) => updateBranding("companyNameAr", event.target.value)}
              />
            </Field>
            <Field label="Abbreviation">
              <input
                value={brandingDraft.companyAbbreviation || ""}
                onChange={(event) => updateBranding("companyAbbreviation", event.target.value)}
              />
            </Field>
            <Field label="Website">
              <input
                dir="ltr"
                value={brandingDraft.website || ""}
                onChange={(event) => updateBranding("website", event.target.value)}
              />
            </Field>
            <Field label="Company address">
              <textarea
                value={brandingDraft.companyAddress || ""}
                onChange={(event) => updateBranding("companyAddress", event.target.value)}
              />
            </Field>
            <Field label="Company phone">
              <input
                dir="ltr"
                value={brandingDraft.companyPhone || ""}
                onChange={(event) => updateBranding("companyPhone", event.target.value)}
              />
            </Field>
            <Field label="Footer contact">
              <select
                value={brandingDraft.footerContactMode || "website"}
                onChange={(event) => updateBranding("footerContactMode", event.target.value)}
              >
                <option value="website">Website</option>
                <option value="address">Address</option>
                <option value="both">Website and address</option>
              </select>
            </Field>
            <Field label="Heading font">
              <select
                value={brandingDraft.headingFontFamily || "georgia"}
                onChange={(event) => updateBranding("headingFontFamily", event.target.value)}
              >
                <option value="georgia">Georgia</option>
                <option value="times">Times New Roman</option>
                <option value="arial">Arial</option>
                <option value="tahoma">Tahoma</option>
                <option value="segoe">Segoe UI</option>
                <option value="cairo">Cairo</option>
              </select>
            </Field>
            <Field label="Body font">
              <select
                value={brandingDraft.bodyFontFamily || "arial"}
                onChange={(event) => updateBranding("bodyFontFamily", event.target.value)}
              >
                <option value="arial">Arial</option>
                <option value="tahoma">Tahoma</option>
                <option value="segoe">Segoe UI</option>
                <option value="cairo">Cairo</option>
                <option value="georgia">Georgia</option>
                <option value="times">Times New Roman</option>
              </select>
            </Field>
            {[
              ["companyNameColor", "Company color"],
              ["lineColor", "Report line color"],
              ["tableHeaderBg", "Table header background"],
              ["tableHeaderText", "Table header text"],
              ["tableBodyText", "Table body text"],
              ["tableOddBg", "Odd row background"],
              ["tableEvenBg", "Even row background"],
              ["qrColor", "QR color"],
              ["qrBackground", "QR background"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="color"
                  value={brandingDraft[key] || "#000000"}
                  onChange={(event) => updateBranding(key, event.target.value)}
                />
              </Field>
            ))}
            <label className="check-tile">
              <input
                type="checkbox"
                checked={!!brandingDraft.showAddressInDateBlock}
                onChange={(event) =>
                  updateBranding("showAddressInDateBlock", event.target.checked)
                }
              />
              <span>Show address under report date block</span>
            </label>
            <button type="submit" className="primary" disabled={!canEditTableStyles}>
              <Save size={18} /> Save branding
            </button>
          </form>
        ) : (
          <div className="empty-state">Report branding is available for admins only.</div>
        )}
      </section>

      <section className="panel subscription-panel">
        <div className="panel-head">
          <h2>
            <WalletCards size={18} /> الإشتراك والدفع
          </h2>
          <button
            type="button"
            className="ghost"
            onClick={syncManagerNow}
            disabled={managerSyncing}
          >
            <RefreshCw size={16} /> تحديث Manager
          </button>
        </div>
        {managerSubscriptionError && (
          <div className="error-state">{managerSubscriptionError}</div>
        )}
        <div className="subscription-mode-grid" role="tablist" aria-label="Payment mode">
          <button
            type="button"
            className={managerPaymentMode === "recurring" ? "active" : ""}
            onClick={() => setManagerPaymentMode("recurring")}
          >
            اشتراك متجدد
          </button>
          <button
            type="button"
            className={managerPaymentMode === "one_time" ? "active" : ""}
            onClick={() => setManagerPaymentMode("one_time")}
          >
            دفع مرة واحدة
          </button>
        </div>
        <div className="subscription-cycle" role="tablist" aria-label="Billing cycle">
          <button
            type="button"
            className={managerBillingCycle === "monthly" ? "active" : ""}
            onClick={() => setManagerBillingCycle("monthly")}
          >
            شهري
          </button>
          <button
            type="button"
            className={managerBillingCycle === "annually" ? "active" : ""}
            onClick={() => setManagerBillingCycle("annually")}
          >
            سنوي
          </button>
        </div>
        <div className="subscription-plans">
          {managerSubscriptionPlans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              className={selectedManagerPlan?.id === plan.id ? "active" : ""}
              onClick={() => setSelectedManagerPlanId(plan.id)}
            >
              <strong>{plan.name}</strong>
              <span>{plan.users || 1} مستخدم</span>
              <b>
                {money(managerPlanPrice(plan))} {plan.currency || managerCurrency}
              </b>
            </button>
          ))}
          {!managerSubscriptionLoading && !managerSubscriptionPlans.length && (
            <div className="empty-state">لا توجد خطط اشتراك جاهزة من المدير الآن.</div>
          )}
        </div>
        {(managerSubscriptionStatus || managerPayments.length > 0) && (
          <div className="manager-sync-summary">
            {managerSubscriptionStatus && (
              <span>
                الحالة:{" "}
                {managerSubscriptionStatus.has_access ? "نشط" : "يحتاج مراجعة"}
              </span>
            )}
            {activeManagerSubscription?.plan_name && (
              <span>{activeManagerSubscription.plan_name}</span>
            )}
            {managerPaidThroughLabel && <span>مدفوع حتى {managerPaidThroughLabel}</span>}
            {managerSubscriptionCancelsAtPeriodEnd && (
              <span>لن يتم التجديد بعد نهاية الفترة</span>
            )}
            {managerPayments.length > 0 && (
              <span>{managerPayments.length} دفعة مسجلة في المدير</span>
            )}
            {managerCanCancelSubscription && (
              <button
                type="button"
                className="danger-text"
                onClick={cancelManagerSubscription}
                disabled={managerCanceling}
              >
                <X size={16} /> إلغاء التجديد
              </button>
            )}
          </div>
        )}
        <div
          className="paypal-embedded-shell"
          data-paypal-theme={themeMode === "gold" ? "gold" : "blue"}
          dir="ltr"
        >
          <div className="paypal-checkout-head">
            <div className="paypal-brand-lockup" aria-label="PayPal Checkout">
              <span className="paypal-wordmark">
                <b>Pay</b>
                <b>Pal</b>
              </span>
              <small>PayPal Checkout</small>
            </div>
            <div className="paypal-total-pill">
              <span>
                {managerPaymentMode === "recurring"
                  ? "Recurring subscription"
                  : "One-time payment"}
              </span>
              <strong>
                {money(managerCheckoutAmount)} {managerCurrency}
              </strong>
            </div>
          </div>
          {managerSubscriptionLoading && (
            <div className="manager-muted">Loading manager plans...</div>
          )}
          <div ref={managerPaypalButtonsRef} className="paypal-buttons-host" />
          {managerPaymentMode === "one_time" && (
            <>
              <div className="paypal-divider">
                <span>Card checkout</span>
              </div>
              <div ref={managerPaypalCardRef} className="paypal-card-container" />
              <button
                ref={managerPaypalCardSubmitRef}
                type="button"
                className="paypal-card-submit"
                hidden
              >
                Pay securely {money(managerCheckoutAmount)} {managerCurrency}
              </button>
            </>
          )}
          {managerCheckoutLoading && (
            <div className="manager-muted">Preparing PayPal checkout...</div>
          )}
          {managerCheckoutError && (
            <div className="error-state">{managerCheckoutError}</div>
          )}
        </div>
        <div className="account-danger-zone">
          <div>
            <strong>
              <AlertTriangle size={17} /> Delete company account
            </strong>
            <span>
              Creates a database archive, then removes local saved users, chat,
              documents, payments, and subscription state from this app.
            </span>
          </div>
          <input
            dir="ltr"
            value={managerDeletePhrase}
            onChange={(event) => setManagerDeletePhrase(event.target.value)}
            placeholder="DELETE"
            disabled={!adminUnlocked || managerDeletingAccount}
          />
          <button
            type="button"
            className="danger"
            onClick={deleteManagerAccount}
            disabled={
              !adminUnlocked ||
              managerDeletePhrase !== "DELETE" ||
              managerDeletingAccount
            }
          >
            <Trash2 size={17} /> Delete account
          </button>
        </div>
      </section>

      <section className="panel users-panel">
        <div className="panel-head">
          <h2>
            <Users size={18} /> المستخدمون
          </h2>
          <span className="user-chip">{currentUser?.display_name}</span>
        </div>
        <form className="form-grid user-form" onSubmit={changeMyPassword}>
          <Field label="كلمة المرور الحالية">
            <input
              type="password"
              value={passwordDraft.current_password}
              onChange={(event) =>
                setPasswordDraft({
                  ...passwordDraft,
                  current_password: event.target.value,
                })
              }
            />
          </Field>
          <Field label="كلمة المرور الجديدة">
            <input
              type="password"
              value={passwordDraft.new_password}
              onChange={(event) =>
                setPasswordDraft({
                  ...passwordDraft,
                  new_password: event.target.value,
                })
              }
              required
            />
          </Field>
          <button type="submit">
            <KeyRound size={18} /> تغيير كلمتي
          </button>
        </form>
        {isCompanyAdmin ? (
          <>
            <form className="form-grid user-form" onSubmit={addUser}>
              <Field label="اسم الدخول">
                <input
                  value={newUser.username}
                  onChange={(event) =>
                    setNewUser({ ...newUser, username: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="الاسم في التقارير">
                <input
                  value={newUser.display_name}
                  onChange={(event) =>
                    setNewUser({ ...newUser, display_name: event.target.value })
                  }
                  placeholder="Eng. Name"
                  required
                />
              </Field>
              <Field label="كلمة المرور">
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser({ ...newUser, password: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="الدور">
                <select
                  value={newUser.role}
                  onChange={(event) =>
                    setNewUser({ ...newUser, role: event.target.value })
                  }
                >
                  <option value="user">مستخدم</option>
                  <option value="manager">Manager</option>
                  <option value="admin">مدير</option>
                </select>
              </Field>
              {USER_PERMISSION_FIELDS.map((permission) => (
                <label
                  key={permission.key}
                  className="check-tile"
                  title={permission.title}
                >
                  <input
                    type="checkbox"
                    checked={!!newUser[permission.key]}
                    onChange={(event) =>
                      setNewUser({
                        ...newUser,
                        [permission.key]: event.target.checked ? 1 : 0,
                      })
                    }
                  />
                  <span>{permission.label}</span>
                </label>
              ))}
              <button type="submit" className="primary">
                <UserPlus size={18} /> إضافة مستخدم
              </button>
            </form>
            <div className="table-scroll compact-table">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>اسم الدخول</th>
                    <th>اسم التقرير</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th>آخر ظهور</th>
                    <th>وقت العمل</th>
                    {USER_PERMISSION_FIELDS.map((permission) => (
                      <th key={permission.key}>{permission.shortLabel}</th>
                    ))}
                    <th>كلمة مرور جديدة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.id}</td>
                      {editingUserId === user.id ? (
                        <>
                          <td>
                            <input
                              value={editingUser.username ?? user.username}
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  username: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={
                                editingUser.display_name ?? user.display_name
                              }
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  display_name: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <select
                              value={editingUser.role ?? user.role}
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  role: event.target.value,
                                })
                              }
                            >
                              <option value="user">user</option>
                              <option value="manager">manager</option>
                              <option value="admin">admin</option>
                            </select>
                          </td>
                          <td>
                            <select
                              value={String(
                                editingUser.is_active ?? user.is_active,
                              )}
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  is_active: event.target.value === "1" ? 1 : 0,
                                })
                              }
                            >
                              <option value="1">نشط</option>
                              <option value="0">موقوف</option>
                            </select>
                          </td>
                          <td>{formatUserDateTime(user.last_seen_at)}</td>
                          <td>
                            {user.work_time_label ||
                              workTimeLabel(user.work_time_seconds)}
                          </td>
                          {USER_PERMISSION_FIELDS.map((permission) => (
                            <td key={permission.key}>
                              <input
                                type="checkbox"
                                checked={
                                  !!(
                                    editingUser[permission.key] ??
                                    user[permission.key]
                                  )
                                }
                                onChange={(event) =>
                                  setEditingUser({
                                    ...editingUser,
                                    [permission.key]: event.target.checked
                                      ? 1
                                      : 0,
                                  })
                                }
                                title={permission.title}
                              />
                            </td>
                          ))}
                          <td>
                            <input
                              type="password"
                              value={editingUser.password || ""}
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  password: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="row-actions">
                            <button
                              type="button"
                              className="icon-button"
                              title="حفظ"
                              onClick={() => saveUser(user.id)}
                            >
                              <Save size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              title="إلغاء"
                              onClick={() => {
                                setEditingUserId(null);
                                setEditingUser({});
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{user.username}</td>
                          <td>
                            <span className="presence-name">
                              <span
                                className={
                                  user.is_online
                                    ? "presence-dot online"
                                    : "presence-dot offline"
                                }
                                title={user.is_online ? "Online" : "Offline"}
                              />
                              <span>{user.display_name}</span>
                            </span>
                          </td>
                          <td>{user.role}</td>
                          <td>{user.is_active ? "نشط" : "موقوف"}</td>
                          <td>{formatUserDateTime(user.last_seen_at)}</td>
                          <td>
                            {user.work_time_label ||
                              workTimeLabel(user.work_time_seconds)}
                          </td>
                          {USER_PERMISSION_FIELDS.map((permission) => (
                            <td key={permission.key}>
                              {user[permission.key] ? "نعم" : "-"}
                            </td>
                          ))}
                          <td> </td>
                          <td className="row-actions">
                            <button
                              type="button"
                              className="icon-button"
                              title="تعديل"
                              onClick={() => {
                                setEditingUserId(user.id);
                                setEditingUser({ ...user, password: "" });
                              }}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button danger"
                              title="إيقاف"
                              onClick={() => deleteUser(user.id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state">إدارة المستخدمين للمدير فقط</div>
        )}
      </section>

      <section className="terms-layout">
        <TermEditor
          title="شروط الأفراد"
          value={retailTerms}
          onChange={setRetailTerms}
          onSave={() => saveTerms("retail", retailTerms)}
          disabled={!canEditTerms}
        />
        <TermEditor
          title="شروط الشركات"
          value={corporateTerms}
          onChange={setCorporateTerms}
          onSave={() => saveTerms("corporate", corporateTerms)}
          disabled={!canEditTerms}
        />
      </section>

      <section className="settings-bottom-panels">
        <DashboardMetricGrid summary={dashboardSummary} />
        <DocumentStatusPanel docs={documentStatuses} />
      </section>
    </div>
  );
}

function TermEditor({ title, value, onChange, onSave, disabled = false }) {
  const sections = value.sections || [];
  function updateSection(index, patch) {
    const next = sections.map((section, itemIndex) =>
      itemIndex === index ? { ...section, ...patch } : section,
    );
    onChange({ ...value, sections: next });
  }
  function addSection() {
    onChange({ ...value, sections: [...sections, { title: "", lines: [""] }] });
  }
  function removeSection(index) {
    onChange({
      ...value,
      sections: sections.filter((_, itemIndex) => itemIndex !== index),
    });
  }
  return (
    <section className="panel term-editor">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="action-row">
          <button type="button" onClick={addSection} disabled={disabled}>
            <Plus size={17} /> قسم
          </button>
          <button type="button" className="primary" onClick={onSave} disabled={disabled}>
            <Check size={17} /> حفظ
          </button>
        </div>
      </div>
      <div className="term-sections">
        {sections.map((section, index) => (
          <div className="term-section" key={index}>
            <Field label="العنوان">
              <input
                value={section.title || ""}
                disabled={disabled}
                onChange={(event) =>
                  updateSection(index, { title: event.target.value })
                }
              />
            </Field>
            <Field label="البنود">
              <textarea
                value={(section.lines || []).join("\n")}
                disabled={disabled}
                onChange={(event) =>
                  updateSection(index, {
                    lines: event.target.value.split("\n"),
                  })
                }
              />
            </Field>
            <button
              className="danger-text"
              type="button"
              onClick={() => removeSection(index)}
              disabled={disabled}
            >
              حذف القسم
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

let androidNotificationReadyPromise = null;

async function androidLocalNotifications() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform?.() || Capacitor.getPlatform?.() !== "android")
      return null;
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if (!androidNotificationReadyPromise) {
      androidNotificationReadyPromise = (async () => {
        const status = await LocalNotifications.checkPermissions();
        if (status.display !== "granted") {
          const requested = await LocalNotifications.requestPermissions();
          if (requested.display !== "granted") return null;
        }
        await LocalNotifications.createChannel?.({
          id: "team-chat",
          name: "Team Chat",
          description: "New team chat messages",
          importance: 4,
          visibility: 1,
          lights: true,
          vibration: true,
        }).catch(() => null);
        return LocalNotifications;
      })();
    }
    return androidNotificationReadyPromise;
  } catch {
    return null;
  }
}

async function prepareChatNotifications() {
  if (window.priceOfferDesktop?.showNotification) return true;
  const localNotifications = await androidLocalNotifications();
  if (localNotifications) return true;
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function chatNotificationBody(row = {}, count = 1) {
  const message = String(row.message || "").trim();
  const attachment = row.attachment_name
    ? `Attachment: ${row.attachment_name}`
    : "";
  const body = message || attachment || "New message";
  return count > 1 ? `${body}\n${count} new messages` : body;
}

async function showChatNotification(row = {}, count = 1) {
  const title =
    count > 1
      ? `${count} new Team Chat messages`
      : `Team Chat - ${row.sender || "New message"}`;
  const body = chatNotificationBody(row, count);
  try {
    if (window.priceOfferDesktop?.showNotification) {
      await window.priceOfferDesktop.showNotification({
        title,
        body,
        section: "dashboard",
      });
      return true;
    }
    const localNotifications = await androidLocalNotifications();
    if (localNotifications) {
      await localNotifications.schedule({
        notifications: [
          {
            id: Math.max(1, Number(row.id || Date.now()) % 2147480000),
            title,
            body,
            channelId: "team-chat",
          },
        ],
      });
      return true;
    }
    if ("Notification" in window) {
      const allowed =
        Notification.permission === "granted" ||
        (Notification.permission !== "denied" &&
          (await Notification.requestPermission()) === "granted");
      if (allowed) {
        const notification = new Notification(title, {
          body,
          icon: appLogo,
          tag: `team-chat-${row.id || Date.now()}`,
        });
        notification.onclick = () => window.focus();
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

function fileRelativePath(file) {
  return String(file?.webkitRelativePath || file?.relativePath || file?.name || "file");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function initialsForName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "؟";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.slice(0, 2).map((word) => [...word][0]).join("").toUpperCase();
  }
  return [...words[0]][0]?.toUpperCase() || "؟";
}

function ComboField({ label, value, options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const cleanOptions = uniqueValues(options);
  const typed = normalizeArabic(value || "");
  const shownOptions = typed
    ? cleanOptions.filter((option) => normalizeArabic(option).includes(typed))
    : cleanOptions;
  const listId = useMemo(
    () => `combo-${Math.random().toString(36).slice(2)}`,
    [],
  );
  return (
    <label
      className="field combo-field"
      title={`${label} - اكتب للبحث أو اختر من البيانات السابقة`}
    >
      <span>{label}</span>
      <input
        value={value}
        list={listId}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 350)}
        onChange={(event) => {
          setOpen(true);
          onChange(event.target.value);
        }}
        autoComplete="off"
      />
      <datalist id={listId}>
        {shownOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      {open && shownOptions.length > 0 && (
        <div className="inline-suggestions">
          {shownOptions.slice(0, 10).map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <select
        className="combo-picker"
        value=""
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
      >
        <option value="">اختيار من البيانات السابقة</option>
        {shownOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MultiComboField({
  label,
  values = [],
  options = [],
  onChange,
  allLabel = "كل المشروعات",
  multipleLabel = "مشروعات محددة",
  clearLabel = "عرض الكل",
}) {
  const selected = new Set(values);
  const labelFor = (value) =>
    options.find((option) => option.value === value)?.label || value;
  const toggleValue = (value) => {
    const next = selected.has(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    onChange(next);
  };
  return (
    <div className="field multi-combo-field">
      <span>{label}</span>
      <details>
        <summary>
          {values.length
            ? values.length === 1
              ? labelFor(values[0])
              : `${values.length} ${multipleLabel}`
            : allLabel}
        </summary>
        <div className="multi-combo-menu">
          <button
            type="button"
            className="multi-combo-clear"
            onClick={() => onChange([])}
          >
            {clearLabel}
          </button>
          {options.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.has(option.value)}
                onChange={() => toggleValue(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </details>
      {values.length > 0 && (
        <div className="multi-combo-chips">
          {values.map((value) => (
            <button key={value} type="button" onClick={() => toggleValue(value)}>
              {labelFor(value)} <X size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WaveformAudio({ src, label = "Voice message" }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(
    () =>
      Array.from({ length: 44 }, (_, index) =>
        22 + ((index * 37 + label.length * 11) % 70),
      ),
    [label],
  );
  const finiteDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
  const progress = finiteDuration
    ? Math.min(1, Math.max(0, safeCurrentTime / finiteDuration))
    : 0;
  const audioDuration = (audio) => {
    const value = Number(audio?.duration || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const timeLabel = (seconds) => {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return "--:--";
    const safe = Math.max(0, Math.floor(value));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  };
  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  }
  useEffect(() => {
    if (!src || finiteDuration) return undefined;
    let cancelled = false;
    async function recoverDuration() {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const response = await fetch(src);
        if (!response.ok) return;
        const buffer = await response.arrayBuffer();
        const context = new AudioContextClass();
        const decoded = await context.decodeAudioData(buffer.slice(0));
        if (typeof context.close === "function") await context.close();
        if (!cancelled && Number.isFinite(decoded.duration) && decoded.duration > 0) {
          setDuration(decoded.duration);
        }
      } catch {
        // Some codecs cannot be decoded by AudioContext; keep the clean unknown-duration UI.
      }
    }
    recoverDuration();
    return () => {
      cancelled = true;
    };
  }, [finiteDuration, src]);
  return (
    <div className={`wave-audio${finiteDuration ? "" : " is-duration-unknown"}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(audioDuration(event.currentTarget))}
        onDurationChange={(event) => setDuration(audioDuration(event.currentTarget))}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="wave-play" onClick={togglePlayback} title={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="wave-track">
        <div className="wave-bars" aria-hidden="true">
          {bars.map((height, index) => (
            <i
              key={index}
              className={index / bars.length <= progress ? "played" : ""}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <input
          aria-label="Voice message position"
          type="range"
          min="0"
          max={finiteDuration || 1}
          step="0.05"
          value={finiteDuration ? Math.min(safeCurrentTime, finiteDuration) : 0}
          disabled={!finiteDuration}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (audioRef.current) audioRef.current.currentTime = next;
            setCurrentTime(next);
          }}
        />
      </div>
      <span className="wave-time">
        {timeLabel(safeCurrentTime)} / {finiteDuration ? timeLabel(finiteDuration) : "--:--"}
      </span>
      <Volume2 size={15} className="wave-volume" />
    </div>
  );
}

function ChatMediaPreview({ attachment, onClose, setMessage }) {
  const [zoom, setZoom] = useState(1);
  if (!attachment) return null;
  async function shareMedia() {
    try {
      if (navigator.share) {
        await navigator.share({ title: attachment.name, url: attachment.url });
      } else {
        if (await copyTextToClipboard(attachment.url)) {
          setMessage?.("Attachment link copied");
        } else {
          throw new Error("Clipboard access is not available.");
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") setMessage?.(`Share failed: ${error.message}`);
    }
  }
  return (
    <div
      className="chat-file-preview"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="chat-file-preview-head">
        <strong>{attachment.name}</strong>
        <div className="chat-preview-actions">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} title="Zoom out"><ZoomOut size={18} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} title="Zoom in"><ZoomIn size={18} /></button>
          <a className="chat-preview-button" href={attachment.url} download={attachment.name} title="Download"><FileDown size={18} /></a>
          <button type="button" onClick={shareMedia} title="Share"><Share2 size={18} /></button>
          <button type="button" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
      </div>
      <div className="chat-preview-stage">
        {attachment.type === "image" ? (
          <img src={attachment.url} alt={attachment.name} style={{ transform: `scale(${zoom})` }} />
        ) : (
          <iframe title={attachment.name} src={attachment.url} style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }} />
        )}
      </div>
    </div>
  );
}

function ChatWidget({
  api,
  apiBase,
  currentUser,
  setMessage,
  onOpenMention,
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [pendingAttachmentType, setPendingAttachmentType] = useState("file");
  const [uploadProgress, setUploadProgress] = useState(null);
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [seenMessage, setSeenMessage] = useState(null);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastUnread, setLastUnread] = useState(null);
  const [dismissedUnreadId, setDismissedUnreadId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState(
    Array.from({ length: 36 }, () => 18),
  );
  const [voiceSending, setVoiceSending] = useState(false);
  const [pendingFileUrl, setPendingFileUrl] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactionPicker, setReactionPicker] = useState(null);
  const [folderBrowser, setFolderBrowser] = useState(null);
  const [folderEntries, setFolderEntries] = useState([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState("most_used");
  const [emojiUsage, setEmojiUsage] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("priceOfferEmojiUsage") || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored))
        return stored;
      return {};
    } catch {
      return {};
    }
  });
  const mostUsedEmojis = useMemo(() => {
    const defaults = [
      "❤️", "👍", "😂", "😊", "🙏", "✅", "🎉", "😍", "🥹", "😄",
      "🔥", "👏", "🤝", "💯", "✨", "😘", "🙂", "🥳", "😝", "🤔",
      "👀", "📌", "⚠️", "❌", "💡", "📄", "🏗️", "💰",
    ];
    const ranked = Object.entries(emojiUsage)
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
      .map(([emoji]) => emoji)
      .filter(Boolean);
    return [...new Set([...ranked, ...defaults])].slice(0, 28);
  }, [emojiUsage]);
  const activeEmojiSection =
    emojiCategory === "most_used"
      ? { label: "Most used", emojis: mostUsedEmojis }
      : CHAT_EMOJI_CATEGORIES.find(
          (category) => category.id === emojiCategory,
        ) || CHAT_EMOJI_CATEGORIES[0];
  const chatPanelRef = useRef(null);
  const chatToggleRef = useRef(null);
  const messageListRef = useRef(null);
  const composerRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const reactionPickerRef = useRef(null);
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const firstUnreadIdRef = useRef(null);
  const positionedOpenRef = useRef(false);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStreamRef = useRef(null);
  const recordingStartedAtRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const recordingAudioContextRef = useRef(null);
  const recordingAnimationRef = useRef(null);
  const notificationsPrimedRef = useRef(false);
  const latestMessageIdRef = useRef(0);
  const rowsCountRef = useRef(0);
  const currentUserName =
    currentUser?.display_name || currentUser?.username || "User";
  const mentionQuery = useMemo(() => {
    const match = String(text || "").match(/(?:^|\s)@([^\s@]*)$/u);
    if (!match) return null;
    const at = String(text).lastIndexOf("@");
    return { query: match[1] || "", start: at, end: String(text).length };
  }, [text]);

  const isOwnMessage = useCallback(
    (row) => String(row?.sender || "") === currentUserName,
    [currentUserName],
  );

  useEffect(() => {
    prepareChatNotifications().catch(() => {});
  }, []);

  useEffect(() => {
    rowsCountRef.current = rows.length;
  }, [rows.length]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      const target = event.target;
      if (
        chatPanelRef.current?.contains(target) ||
        chatToggleRef.current?.contains(target) ||
        reactionPickerRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeOutside, true);
  }, [open]);

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const closeEmojiPicker = (event) => {
      const target = event.target;
      if (
        emojiPickerRef.current?.contains(target) ||
        emojiButtonRef.current?.contains(target)
      )
        return;
      setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", closeEmojiPicker, true);
    return () =>
      document.removeEventListener("pointerdown", closeEmojiPicker, true);
  }, [emojiOpen]);

  useEffect(() => {
    if (!reactionPicker) return undefined;
    const closeReactionPicker = (event) => {
      const target = event.target;
      if (reactionPickerRef.current?.contains(target)) return;
      setReactionPicker(null);
    };
    document.addEventListener("pointerdown", closeReactionPicker, true);
    return () =>
      document.removeEventListener("pointerdown", closeReactionPicker, true);
  }, [reactionPicker]);

  const loadMessages = useCallback(async () => {
    try {
      const data = await api.request(
        `/api/chat/messages?limit=120&user_id=${encodeURIComponent(currentUser?.id || currentUserName)}`,
      );
      const nextRows = data.rows || [];
      const newestMessageId = nextRows.reduce(
        (maxId, row) => Math.max(maxId, Number(row.id || 0)),
        0,
      );
      if (!notificationsPrimedRef.current) {
        notificationsPrimedRef.current = true;
        latestMessageIdRef.current = newestMessageId;
      } else {
        const newIncoming = !open
          ? nextRows.filter(
              (row) =>
                Number(row.id || 0) > latestMessageIdRef.current &&
                !isOwnMessage(row),
            )
          : [];
        if (newIncoming.length) {
          showChatNotification(newIncoming.at(-1), newIncoming.length);
        }
        latestMessageIdRef.current = Math.max(
          latestMessageIdRef.current,
          newestMessageId,
        );
      }
      setRows(nextRows);
      const unreadIds = nextRows
        .filter(
          (row) =>
            !isOwnMessage(row) &&
            !(row.seen || []).some(
              (mark) => mark.user_name === currentUserName,
            ),
        )
        .map((row) => row.id)
        .filter(Boolean);
      if (!open && unreadIds.length)
        firstUnreadIdRef.current = unreadIds[0];
      setUnreadCount(open ? 0 : unreadIds.length);
      const newestUnread = !open && unreadIds.length
        ? nextRows.find((row) => row.id === unreadIds[unreadIds.length - 1])
        : null;
      setLastUnread(
        newestUnread && newestUnread.id !== dismissedUnreadId
          ? newestUnread
          : null,
      );
      if (open && unreadIds.length) {
        const seenAt = new Date().toISOString();
        await api.request("/api/chat/read", {
          method: "POST",
          body: JSON.stringify({
            user_name: currentUserName,
            message_ids: unreadIds,
          }),
        });
        setRows((current) =>
          current.map((row) =>
            unreadIds.includes(row.id)
              ? {
                  ...row,
                  seen: [
                    ...(row.seen || []),
                    { user_name: currentUserName, seen_at: seenAt },
                  ],
                }
              : row,
          ),
        );
      }
    } catch (error) {
      if (error?.paymentRequired || error?.status === 402) return;
      if (error?.isNetworkError && rowsCountRef.current > 0) return;
      setMessage?.(`Chat error: ${error.message}`);
    }
  }, [api, currentUser?.id, currentUserName, dismissedUnreadId, isOwnMessage, open, setMessage]);

  useEffect(() => {
    loadMessages();
    const timer = window.setInterval(loadMessages, 8000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  useEffect(() => {
    if (!open) {
      positionedOpenRef.current = false;
      setShowJumpToLatest(false);
      setEmojiOpen(false);
      return undefined;
    }
    if (!rows.length || positionedOpenRef.current) return undefined;
    const timer = window.setTimeout(() => {
      const list = messageListRef.current;
      if (!list) return;
      const firstUnreadIndex = rows.findIndex(
        (row) => Number(row.id) === Number(firstUnreadIdRef.current),
      );
      const anchor =
        firstUnreadIndex > 0
          ? rows[firstUnreadIndex - 1]
          : firstUnreadIndex === 0
            ? rows[0]
            : rows[rows.length - 1];
      const target = anchor
        ? list.querySelector(`[data-message-id="${anchor.id}"]`)
        : null;
      if (target && firstUnreadIndex >= 0)
        target.scrollIntoView({ block: "start" });
      else list.scrollTop = list.scrollHeight;
      positionedOpenRef.current = true;
      firstUnreadIdRef.current = null;
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      setShowJumpToLatest(distance > 96);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open, rows]);

  useEffect(() => {
    if (!open || !mentionQuery) {
      setMentionSuggestions([]);
      setMentionLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setMentionLoading(true);
      const query = mentionQuery.query.trim();
      try {
        const [users, documents, customers, contractors] = await Promise.all([
          api.request("/api/users"),
          api.request(`/api/documents?q=${encodeURIComponent(query)}`),
          api.request(`/api/parties?role=customer&q=${encodeURIComponent(query)}`),
          api.request(`/api/parties?role=contractor&q=${encodeURIComponent(query)}`),
        ]);
        if (cancelled) return;
        const normalizedQuery = query.toLowerCase();
        const candidates = [
          ...(users || []).map((user) => ({
            type: "user",
            token: String(user.username || user.id || ""),
            title: user.display_name || user.username || "User",
            detail: user.is_online ? "مستخدم • متصل" : "مستخدم",
          })),
          ...(documents || []).map((document) => ({
            type: "document",
            token: String(document.operation_no || document.document_no || document.id || ""),
            title: `${documentTypeLabel(document.document_type)} ${document.operation_no || document.document_no || document.id}`,
            detail: [document.customer_name, document.project].filter(Boolean).join(" • "),
          })),
          ...(customers || []).map((party) => ({
            type: "customer",
            token: String(party.id || ""),
            title: party.display_name || party.base_name || "عميل",
            detail: `عميل • ID ${party.id}`,
          })),
          ...(contractors || []).map((party) => ({
            type: "contractor",
            token: String(party.id || ""),
            title: party.display_name || party.base_name || "مقاول",
            detail: `مقاول • ID ${party.id}`,
          })),
        ].filter(
          (item) =>
            item.token &&
            (!normalizedQuery ||
              `${item.token} ${item.title} ${item.detail}`.toLowerCase().includes(normalizedQuery)),
        );
        const unique = [];
        const seen = new Set();
        for (const item of candidates) {
          const key = `${item.type}:${item.token}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(item);
          if (unique.length >= 10) break;
        }
        setMentionSuggestions(unique);
        setMentionActiveIndex(0);
      } catch (error) {
        if (!cancelled) {
          setMentionSuggestions([]);
          setMessage?.(`Mention lookup failed: ${error.message}`);
        }
      } finally {
        if (!cancelled) setMentionLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, mentionQuery, open, setMessage]);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current || Date.now();
      setRecordingSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      recorderRef.current = null;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      if (recordingAnimationRef.current)
        window.cancelAnimationFrame(recordingAnimationRef.current);
      recordingAudioContextRef.current?.close?.().catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!file) {
      setPendingFileUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPendingFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString("en-GB");
  }

  function readFileAsDataUrl(selectedFile) {
    return new Promise((resolve, reject) => {
      if (!selectedFile) return resolve(null);
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          name: selectedFile.name,
          type: selectedFile.type,
          dataUrl: reader.result,
        });
      reader.onerror = () => reject(reader.error || new Error("File error"));
      reader.readAsDataURL(selectedFile);
    });
  }

  function pendingAttachmentSummary(items = pendingAttachments, type = pendingAttachmentType) {
    const totalSize = items.reduce((sum, item) => sum + Number(item.file?.size || 0), 0);
    const folderName =
      type === "folder"
        ? fileRelativePath(items[0]?.file).split(/[\\/]/)[0] || "Folder"
        : "";
    return {
      count: items.length,
      totalSize,
      displayName:
        type === "folder"
          ? folderName
          : items.length === 1
            ? items[0]?.file?.name || "Attachment"
            : `${items.length} files`,
    };
  }

  function chooseManagedFiles(fileList, type = "file") {
    const files = Array.from(fileList || []).filter((item) => item?.size >= 0);
    if (!files.length) return;
    setPendingAttachments(
      files.map((selectedFile) => ({
        file: selectedFile,
        relativePath: fileRelativePath(selectedFile),
      })),
    );
    setPendingAttachmentType(type === "folder" ? "folder" : files.length > 1 ? "multiple_files" : "file");
    setFile(null);
    setEmojiOpen(false);
  }

  async function uploadManagedAttachments(items = pendingAttachments, type = pendingAttachmentType) {
    if (!items.length) return [];
    const uploadItems = items.map((item, index) => ({
      ...item,
      clientId:
        item.clientId ||
        `${index}:${fileRelativePath(item.file)}:${Number(item.file?.size || 0)}`,
    }));
    const summary = pendingAttachmentSummary(items, type);
    const session = await api.request("/api/chat/attachments/sessions", {
      method: "POST",
      body: JSON.stringify({
        created_by: currentUser?.id || currentUserName,
        attachment_type: type,
        display_name: summary.displayName,
        total_size: summary.totalSize,
        entries: uploadItems.map(({ file: selectedFile, relativePath, clientId }) => ({
          client_id: clientId,
          relative_path: relativePath || selectedFile.name,
          display_name: selectedFile.name,
          size_bytes: selectedFile.size,
          mime_type: selectedFile.type || "application/octet-stream",
        })),
      }),
    });
    const attachment = session.attachment;
    const serverEntries = session.entries || [];
    const entryByClientId = new Map(
      serverEntries.map((entry) => [String(entry.client_id || ""), entry]),
    );
    const entryByPath = new Map(
      serverEntries.map((entry) => [String(entry.relative_path || ""), entry]),
    );
    const chunkSize = 1024 * 1024;
    let uploaded = 0;
    for (const item of uploadItems) {
      const selectedFile = item.file;
      const relativePath = item.relativePath || selectedFile.name;
      const serverEntry = entryByClientId.get(String(item.clientId || "")) || entryByPath.get(relativePath);
      if (!serverEntry?.id) throw new Error(`Upload entry not created: ${relativePath}`);
      let offset = 0;
      while (offset < selectedFile.size) {
        const chunk = selectedFile.slice(offset, Math.min(offset + chunkSize, selectedFile.size));
        const data = arrayBufferToBase64(await chunk.arrayBuffer());
        const result = await api.request(
          `/api/chat/attachments/${encodeURIComponent(attachment.id)}/entries/${encodeURIComponent(serverEntry.id)}/chunk`,
          {
            method: "POST",
            body: JSON.stringify({ offset, data }),
          },
        );
        const nextOffset = Number(result.uploaded_bytes || offset + chunk.size);
        uploaded += Math.max(0, nextOffset - offset);
        offset = nextOffset;
        setUploadProgress({
          name: summary.displayName,
          uploaded,
          total: summary.totalSize,
          percent: summary.totalSize ? Math.min(100, Math.round((uploaded / summary.totalSize) * 100)) : 100,
        });
      }
    }
    const completed = await api.request(
      `/api/chat/attachments/${encodeURIComponent(attachment.id)}/complete`,
      { method: "POST", body: JSON.stringify({}) },
    );
    setUploadProgress(null);
    return [completed.attachment || attachment];
  }

  function preferredAudioMimeType() {
    if (!window.MediaRecorder?.isTypeSupported) return "";
    return [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => window.MediaRecorder.isTypeSupported(type)) || "";
  }

  function voiceExtension(mimeType) {
    if (mimeType.includes("mp4")) return "m4a";
    if (mimeType.includes("ogg")) return "ogg";
    return "webm";
  }

  function stopRecordingStream() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }

  function stopRecordingAnalysis() {
    if (recordingAnimationRef.current) {
      window.cancelAnimationFrame(recordingAnimationRef.current);
      recordingAnimationRef.current = null;
    }
    recordingAudioContextRef.current?.close?.().catch(() => {});
    recordingAudioContextRef.current = null;
    setRecordingLevels(Array.from({ length: 36 }, () => 18));
  }

  function startRecordingAnalysis(stream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    recordingAudioContextRef.current = audioContext;
    const draw = () => {
      analyser.getByteFrequencyData(samples);
      let total = 0;
      for (let index = 0; index < samples.length; index += 1)
        total += samples[index];
      const level = Math.max(
        12,
        Math.min(100, (total / samples.length / 140) * 100),
      );
      setRecordingLevels((current) => [...current.slice(1), level]);
      recordingAnimationRef.current = window.requestAnimationFrame(draw);
    };
    draw();
  }

  function recordingTime(value) {
    const minutes = String(Math.floor(value / 60)).padStart(2, "0");
    const seconds = String(value % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  async function sendChatPayload({
    messageText = text,
    selectedFile = file,
    managedItems = pendingAttachments,
    managedType = pendingAttachmentType,
    reply = replyTo,
    clearComposer = true,
    clearReply = true,
  } = {}) {
    if (!String(messageText || "").trim() && !selectedFile && !managedItems.length) return null;
    setSending(true);
    try {
      const managedAttachments = managedItems.length
        ? await uploadManagedAttachments(managedItems, managedType)
        : [];
      const attachment = managedAttachments.length
        ? null
        : await readFileAsDataUrl(selectedFile);
      const row = await api.request("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          sender: currentUser?.display_name || currentUser?.username || "User",
          message: messageText,
          reply_to_id: reply?.id || null,
          attachment,
          attachment_ids: managedAttachments.map((item) => item.id).filter(Boolean),
        }),
      });
      setRows((current) => [...current, row]);
      window.setTimeout(() => scrollToLatest("smooth"), 0);
      if (clearComposer) {
        setText("");
        setFile(null);
        setPendingAttachments([]);
        setPendingAttachmentType("file");
      }
      if (clearReply) setReplyTo(null);
      return row;
    } catch (error) {
      setMessage?.(`Chat send failed: ${error.message}`);
      return null;
    } finally {
      setSending(false);
    }
  }

  async function sendMessage(event) {
    event?.preventDefault?.();
    await sendChatPayload();
  }

  async function sendVoiceMessage(voiceFile) {
    if (!voiceFile?.size) {
      setMessage?.("No voice was captured. Please try again.");
      return;
    }
    setVoiceSending(true);
    try {
      const sent = await sendChatPayload({
        messageText: "",
        selectedFile: voiceFile,
        managedItems: [],
        clearComposer: false,
      });
      if (sent) setMessage?.("Voice message sent.");
    } finally {
      setVoiceSending(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      discardRecordingRef.current = false;
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setMessage?.("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(recordingChunksRef.current, { type });
        const shouldSend = !discardRecordingRef.current && blob.size > 0;
        stopRecordingStream();
        stopRecordingAnalysis();
        recorderRef.current = null;
        setRecording(false);
        setRecordingSeconds(0);
        recordingChunksRef.current = [];
        if (!shouldSend) return;
        const ext = voiceExtension(type);
        await sendVoiceMessage(
          new File([blob], `voice-${Date.now()}.${ext}`, { type }),
        );
      };
      recorder.start(250);
      startRecordingAnalysis(stream);
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setRecording(true);
    } catch (error) {
      setMessage?.(`Voice recording failed: ${error.message}`);
      setRecording(false);
      stopRecordingStream();
      stopRecordingAnalysis();
    }
  }

  function cancelRecording() {
    discardRecordingRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      stopRecordingStream();
      stopRecordingAnalysis();
      setRecording(false);
      setRecordingSeconds(0);
    }
  }

  async function deleteMessage() {
    if (!pendingDelete) return;
    try {
      await api.request(`/api/chat/messages/${pendingDelete.id}`, {
        method: "DELETE",
        body: JSON.stringify({ user_name: currentUserName }),
      });
      setRows((current) =>
        current.filter((row) => row.id !== pendingDelete.id),
      );
      setPendingDelete(null);
    } catch (error) {
      setMessage?.(`Chat delete failed: ${error.message}`);
    }
  }

  function optimisticReactionState(reactions = [], emoji) {
    const userId = String(currentUser?.id || currentUserName);
    const displayName = currentUserName;
    let found = false;
    const next = reactions
      .map((reaction) => {
        if (reaction.emoji !== emoji) return reaction;
        found = true;
        const already = (reaction.users || []).some(
          (user) => String(user.user_id) === userId,
        );
        const users = already
          ? (reaction.users || []).filter((user) => String(user.user_id) !== userId)
          : [
              ...(reaction.users || []),
              {
                user_id: userId,
                display_name: displayName,
                initials: initialsForName(displayName),
              },
            ];
        return {
          ...reaction,
          users,
          count: users.length,
          reacted_by_current: !already,
        };
      })
      .filter((reaction) => Number(reaction.count || 0) > 0);
    if (!found) {
      next.push({
        emoji,
        count: 1,
        users: [
          {
            user_id: userId,
            display_name: displayName,
            initials: initialsForName(displayName),
          },
        ],
        reacted_by_current: true,
      });
    }
    return next;
  }

  async function toggleReaction(row, emoji) {
    if (!row?.id || !emoji) return;
    setReactionPicker(null);
    setRows((current) =>
      current.map((item) =>
        item.id === row.id
          ? { ...item, reactions: optimisticReactionState(item.reactions || [], emoji) }
          : item,
      ),
    );
    try {
      const result = await api.request(`/api/chat/messages/${row.id}/reactions`, {
        method: "POST",
        body: JSON.stringify({
          user_id: currentUser?.id || currentUserName,
          user_name: currentUserName,
          emoji,
        }),
      });
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, reactions: result.reactions || [] } : item,
        ),
      );
    } catch (error) {
      setMessage?.(`Reaction failed: ${error.message}`);
      loadMessages();
    }
  }

  function openReactionPicker(event, row) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    setEmojiOpen(false);
    setReactionPicker({
      message: row,
      left: Math.max(8, Math.min(rect?.left || event?.clientX || 24, window.innerWidth - 330)),
      top: Math.max(8, Math.min((rect?.bottom || event?.clientY || 24) + 6, window.innerHeight - 380)),
    });
  }

  async function openFolderBrowser(attachment, parent = null) {
    if (!attachment?.id) return;
    setFolderBrowser({ attachment, parent });
    setFolderLoading(true);
    try {
      const query = parent ? `?parent=${encodeURIComponent(parent)}` : "";
      const data = await api.request(
        `/api/attachments/${encodeURIComponent(attachment.id)}/entries${query}`,
      );
      setFolderEntries(data.entries || []);
      setFolderBrowser({
        attachment: data.attachment || attachment,
        parent: data.parent || null,
      });
    } catch (error) {
      setMessage?.(`Attachment browse failed: ${error.message}`);
    } finally {
      setFolderLoading(false);
    }
  }

  function mentionParts(value) {
    const source = String(value || "");
    const parts = [];
    const pattern = /@([^\s@,،;؛]+)/gu;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
      const raw = match[0];
      const label = match[1].replace(/[،,;؛]+$/g, "").trim();
      if (!label) continue;
      const labelEnd = match.index + 1 + match[1].indexOf(label) + label.length;
      if (match.index > cursor) {
        parts.push({ type: "text", value: source.slice(cursor, match.index) });
      }
      parts.push({ type: "mention", value: label });
      cursor = labelEnd;
    }
    if (cursor < source.length) parts.push({ type: "text", value: source.slice(cursor) });
    return parts.length ? parts : [{ type: "text", value: source }];
  }

  function renderMessageText(value) {
    return mentionParts(value).map((part, index) =>
      part.type === "mention" ? (
        <button
          key={`${part.value}-${index}`}
          type="button"
          className="chat-mention"
          onClick={() => onOpenMention?.(part.value)}
          title={`Open @${part.value}`}
        >
          @{part.value}
        </button>
      ) : (
        <React.Fragment key={`${part.value}-${index}`}>{part.value}</React.Fragment>
      ),
    );
  }

  function focusRepliedMessage(messageId) {
    const id = Number(messageId);
    if (!id) return;
    const target = messageListRef.current?.querySelector(
      `[data-message-id="${id}"]`,
    );
    if (!target) {
      setMessage?.("The replied message is not in the loaded chat history.");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(id);
    window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === id ? null : current));
    }, 1800);
  }

  function scrollToLatest(behavior = "smooth") {
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior });
    setShowJumpToLatest(false);
  }

  function handleChatScroll() {
    const list = messageListRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    setShowJumpToLatest(distance > 96);
  }

  function selectMention(suggestion) {
    if (!mentionQuery || !suggestion?.token) return;
    const next = `${text.slice(0, mentionQuery.start)}@${suggestion.token} ${text.slice(mentionQuery.end)}`;
    setText(next);
    setMentionSuggestions([]);
    window.setTimeout(() => {
      const composer = composerRef.current;
      if (!composer) return;
      const position = mentionQuery.start + suggestion.token.length + 2;
      composer.focus();
      composer.setSelectionRange(position, position);
    }, 0);
  }

  function handleComposerKeyDown(event) {
    if (!mentionSuggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMentionActiveIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + mentionSuggestions.length) % mentionSuggestions.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectMention(mentionSuggestions[mentionActiveIndex] || mentionSuggestions[0]);
    }
  }

  function handleComposerPaste(event) {
    const imageItem = Array.from(event.clipboardData?.items || []).find(
      (item) =>
        item.kind === "file" &&
        String(item.type || "").toLowerCase().startsWith("image/"),
    );
    if (!imageItem) return;
    const pasted = imageItem.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    const mimeType = pasted.type || "image/png";
    const extension =
      mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/webp"
          ? "webp"
          : mimeType === "image/gif"
            ? "gif"
            : "png";
    setFile(
      new File([pasted], `pasted-image-${Date.now()}.${extension}`, {
        type: mimeType,
      }),
    );
    setPendingAttachments([]);
    setPendingAttachmentType("file");
    setEmojiOpen(false);
  }

  function insertEmoji(emoji) {
    const composer = composerRef.current;
    const start = composer?.selectionStart ?? text.length;
    const end = composer?.selectionEnd ?? start;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(next);
    setEmojiUsage((current) => {
      const updated = {
        ...current,
        [emoji]: Number(current[emoji] || 0) + 1,
      };
      localStorage.setItem("priceOfferEmojiUsage", JSON.stringify(updated));
      return updated;
    });
    window.setTimeout(() => {
      composer?.focus();
      composer?.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }

  return (
    <div className={open ? "chat-widget open" : "chat-widget"}>
      <button
        ref={chatToggleRef}
        type="button"
        className="chat-toggle"
        onClick={() => setOpen((value) => !value)}
        title="Open local chat"
      >
        <MessageCircle size={22} />
        {!open && unreadCount > 0 && (
          <span className="chat-unread-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {!open && lastUnread && (
        <div className="chat-floating-notice">
          <button type="button" onClick={() => setOpen(true)}>
            <strong>{lastUnread.sender || "User"}</strong>
            <span>
              {lastUnread.message || lastUnread.attachment_name || "New message"}
            </span>
          </button>
          <button
            type="button"
            className="chat-floating-close"
            onClick={() => {
              setDismissedUnreadId(lastUnread.id);
              setLastUnread(null);
            }}
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {open && (
        <section className="chat-panel" dir="rtl" ref={chatPanelRef}>
          <div className="chat-head">
            <strong>Team Chat</strong>
            <button type="button" onClick={() => setOpen(false)} title="Close">
              <X size={16} />
            </button>
          </div>
          <div className="chat-messages-shell">
            <div
              className="chat-messages"
              ref={messageListRef}
              onScroll={handleChatScroll}
            >
              {rows.map((row) => {
              const isImage = String(row.attachment_mime || "").startsWith("image/");
              const isAudio = String(row.attachment_mime || "").startsWith("audio/");
              const isPdf =
                String(row.attachment_mime || "").includes("pdf") ||
                String(row.attachment_name || "")
                  .toLowerCase()
                  .endsWith(".pdf");
              const attachmentUrl = row.attachment_url
                ? buildUrl(apiBase, row.attachment_url)
                : "";
              const managedAttachments = Array.isArray(row.attachments)
                ? row.attachments
                : [];
              const isOwn = isOwnMessage(row);
              const seenPeople = (row.seen || []).filter(
                (mark) =>
                  mark.user_name && mark.user_name !== currentUserName,
              );
              return (
                <article
                  key={row.id}
                  data-message-id={row.id}
                  className={[
                    "chat-message",
                    isOwn ? "own" : "other",
                    Number(row.id) === Number(highlightedMessageId)
                      ? "highlighted"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onContextMenu={(event) => openReactionPicker(event, row)}
                >
                  <div className="chat-meta">
                    <strong>{isOwn ? "You" : row.sender || "User"}</strong>
                    <span>{chatDate(row.created_at)}</span>
                  </div>
                  {row.reply && (
                    <button
                      type="button"
                      className="chat-reply-preview"
                      onClick={() => focusRepliedMessage(row.reply.id)}
                      title="Go to replied message"
                    >
                      <strong>
                        {row.reply.sender === currentUserName
                          ? "You"
                          : row.reply.sender || "User"}
                      </strong>
                      <span>
                        {row.reply.message ||
                          row.reply.attachment_name ||
                          "Attachment"}
                      </span>
                    </button>
                  )}
                  {row.message && <p>{renderMessageText(row.message)}</p>}
                  {attachmentUrl &&
                    (isImage ? (
                      <button
                        type="button"
                        className="chat-image-button"
                        onClick={() =>
                          setPreviewAttachment({
                            url: attachmentUrl,
                            name: row.attachment_name || "Image attachment",
                            type: "image",
                          })
                        }
                      >
                        <img src={attachmentUrl} alt={row.attachment_name || "Attachment"} />
                      </button>
                    ) : isAudio ? (
                      <WaveformAudio
                        src={attachmentUrl}
                        label={row.attachment_name || "Voice message"}
                      />
                    ) : isPdf ? (
                      <button
                        type="button"
                        className="chat-attachment-link"
                        onClick={() =>
                          setPreviewAttachment({
                            url: attachmentUrl,
                            name: row.attachment_name || "PDF attachment",
                            type: "pdf",
                          })
                        }
                      >
                        <FileText size={18} />
                        <span>{row.attachment_name || "PDF attachment"}</span>
                      </button>
                    ) : (
                      <a href={attachmentUrl} target="_blank" rel="noreferrer">
                        {row.attachment_name || "Attachment"}
                      </a>
                    ))}
                  {!!managedAttachments.length && (
                    <div className="chat-managed-attachments">
                      {managedAttachments.map((attachment) => {
                        const isFolder = attachment.attachment_type === "folder";
                        const isMultiple = attachment.attachment_type === "multiple_files";
                        const downloadUrl = attachment.download_url
                          ? buildUrl(apiBase, attachment.download_url)
                          : "";
                        return (
                          <article key={attachment.id} className="chat-managed-attachment-card">
                            <div className="chat-managed-attachment-icon">
                              {isFolder ? (
                                <FolderOpen size={24} />
                              ) : isMultiple ? (
                                <Files size={24} />
                              ) : (
                                <FileText size={24} />
                              )}
                            </div>
                            <div>
                              <strong>{attachment.display_name || "Attachment"}</strong>
                              <span>
                                {isFolder
                                  ? `${attachment.file_count || 0} files • ${attachment.folder_count || 0} folders`
                                  : isMultiple
                                    ? `${attachment.file_count || 0} files`
                                    : attachment.mime_type || "File"}
                                {" · "}
                                {formatBytes(attachment.total_size)}
                              </span>
                            </div>
                            <div className="chat-managed-attachment-actions">
                              {(isFolder || isMultiple) && (
                                <button
                                  type="button"
                                  onClick={() => openFolderBrowser(attachment)}
                                >
                                  Browse
                                </button>
                              )}
                              {downloadUrl && (
                                <a href={downloadUrl} target="_blank" rel="noreferrer">
                                  <Download size={15} /> Download
                                </a>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {!!row.reactions?.length && (
                    <div className="chat-reactions" aria-label="Message reactions">
                      {row.reactions.map((reaction) => {
                        const users = reaction.users || [];
                        const shownUsers = users.slice(0, 2);
                        const extraCount = Math.max(0, Number(reaction.count || users.length) - shownUsers.length);
                        return (
                          <button
                            key={reaction.emoji}
                            type="button"
                            className={reaction.reacted_by_current ? "chat-reaction-pill active" : "chat-reaction-pill"}
                            title={users.map((user) => user.display_name).join("\n")}
                            onClick={() => toggleReaction(row, reaction.emoji)}
                          >
                            <span>{reaction.emoji}</span>
                            {shownUsers.map((user) => (
                              <b key={user.user_id}>{user.initials}</b>
                            ))}
                            {extraCount > 0 && <em>+{extraCount}</em>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="chat-actions">
                    <button
                      type="button"
                      className="chat-reaction-button"
                      onClick={(event) => openReactionPicker(event, row)}
                      title="React"
                    >
                      <Smile size={14} />
                    </button>
                    <button
                      type="button"
                      className="chat-reply-button"
                      onClick={() => setReplyTo(row)}
                      title="Reply"
                    >
                      <CornerUpLeft size={14} />
                    </button>
                    {isOwn && (
                      <button
                        type="button"
                        className="chat-seen-button"
                        onClick={() => setSeenMessage({ ...row, seenPeople })}
                        title="Seen by"
                      >
                        <Eye size={14} />
                      </button>
                    )}
                    {isOwn && (
                      <button
                        type="button"
                        className="chat-delete-button"
                        onClick={() => setPendingDelete(row)}
                        title="Delete for everyone"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="chat-more-button"
                      title="More"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </article>
              );
              })}
              {!rows.length && <div className="chat-empty">No messages yet</div>}
            </div>
            {showJumpToLatest && (
              <button
                type="button"
                className="chat-jump-latest"
                onClick={() => scrollToLatest("smooth")}
                title="الانتقال إلى آخر رسالة"
                aria-label="الانتقال إلى آخر رسالة"
              >
                <ArrowDown size={19} />
              </button>
            )}
          </div>
          {replyTo && (
            <div className="chat-compose-reply">
              <div>
                <strong>
                  Replying to{" "}
                  {replyTo.sender === currentUserName
                    ? "You"
                    : replyTo.sender || "User"}
                </strong>
                <span>
                  {replyTo.message ||
                    replyTo.attachment_name ||
                    "Attachment"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                title="Cancel reply"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {recording && (
            <div className="chat-recording-strip" role="status">
              <span className="chat-recording-live" aria-hidden="true" />
              <div className="recording-wave" aria-hidden="true">
                {recordingLevels.map((level, index) => (
                  <i key={index} style={{ height: `${level}%` }} />
                ))}
              </div>
              <span>{recordingTime(recordingSeconds)}</span>
              <button
                type="button"
                onClick={cancelRecording}
                title="Cancel recording"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {file && (
            <div className="chat-pending-file">
              {file.type?.startsWith("image/") && pendingFileUrl ? (
                <img src={pendingFileUrl} alt="Selected attachment preview" />
              ) : (
                <div className="chat-pending-file-icon"><Paperclip size={22} /></div>
              )}
              <div>
                <strong>Ready to send</strong>
                <span>{file.name}</span>
              </div>
              <button type="button" onClick={() => setFile(null)} title="Remove attachment">
                <X size={16} />
              </button>
            </div>
          )}
          {!!pendingAttachments.length && (
            <div className="chat-pending-file">
              <div className="chat-pending-file-icon">
                {pendingAttachmentType === "folder" ? <FolderOpen size={22} /> : <Files size={22} />}
              </div>
              <div>
                <strong>Ready to send</strong>
                <span>
                  {pendingAttachmentSummary().displayName} · {pendingAttachmentSummary().count} item(s) · {formatBytes(pendingAttachmentSummary().totalSize)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingAttachments([]);
                  setPendingAttachmentType("file");
                }}
                title="Remove attachment"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {uploadProgress && (
            <div className="chat-upload-progress" role="status">
              <strong>Uploading {uploadProgress.name}</strong>
              <span>
                {formatBytes(uploadProgress.uploaded)} of {formatBytes(uploadProgress.total)}
              </span>
              <div>
                <i style={{ width: `${uploadProgress.percent || 0}%` }} />
              </div>
            </div>
          )}
          {mentionQuery && (mentionLoading || mentionSuggestions.length > 0) && (
            <div className="chat-mention-list" role="listbox" aria-label="اقتراحات الإشارة">
              {mentionLoading && !mentionSuggestions.length ? (
                <span className="chat-mention-loading">جارٍ البحث…</span>
              ) : (
                mentionSuggestions.map((suggestion, index) => (
                  <button
                    key={`${suggestion.type}-${suggestion.token}`}
                    type="button"
                    role="option"
                    aria-selected={index === mentionActiveIndex}
                    className={index === mentionActiveIndex ? "active" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectMention(suggestion)}
                  >
                    <span className="chat-mention-avatar">@</span>
                    <span>
                      <strong>{suggestion.title}</strong>
                      <small>{suggestion.detail || `@${suggestion.token}`}</small>
                    </span>
                    <code>@{suggestion.token}</code>
                  </button>
                ))
              )}
            </div>
          )}
          {emojiOpen && (
            <div
              ref={emojiPickerRef}
              className="chat-emoji-picker"
              aria-label="لوحة الإيموجي"
            >
              <div className="chat-emoji-tabs">
                <button
                  type="button"
                  className={emojiCategory === "most_used" ? "active" : ""}
                  onClick={() => setEmojiCategory("most_used")}
                >
                  Most used
                </button>
                {CHAT_EMOJI_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={emojiCategory === category.id ? "active" : ""}
                    onClick={() => setEmojiCategory(category.id)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <div className="chat-emoji-section-head">
                <strong>{activeEmojiSection.label}</strong>
                <span>{activeEmojiSection.emojis.length}</span>
              </div>
              <div className="chat-emoji-grid">
                {activeEmojiSection.emojis.map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertEmoji(emoji)}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          {reactionPicker && createPortal(
            <div
              ref={reactionPickerRef}
              className="chat-emoji-picker chat-reaction-picker"
              aria-label="لوحة تفاعل الرسالة"
              style={{
                left: `${reactionPicker.left}px`,
                top: `${reactionPicker.top}px`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="chat-emoji-tabs">
                <button
                  type="button"
                  className={emojiCategory === "most_used" ? "active" : ""}
                  onClick={() => setEmojiCategory("most_used")}
                >
                  Most used
                </button>
                {CHAT_EMOJI_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={emojiCategory === category.id ? "active" : ""}
                    onClick={() => setEmojiCategory(category.id)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <div className="chat-emoji-section-head">
                <strong>{activeEmojiSection.label}</strong>
                <button
                  type="button"
                  onClick={() => setReactionPicker(null)}
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="chat-emoji-grid">
                {activeEmojiSection.emojis.map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleReaction(reactionPicker.message, emoji)}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
          <form className="chat-compose" onSubmit={sendMessage}>
            <textarea
              ref={composerRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setEmojiOpen(false);
              }}
              onFocus={() => setEmojiOpen(false)}
              onPointerDown={() => setEmojiOpen(false)}
              onPaste={handleComposerPaste}
              onKeyDown={handleComposerKeyDown}
              placeholder="Write a message"
              rows={2}
              dir="auto"
            />
            <button
              ref={emojiButtonRef}
              type="button"
              className={emojiOpen ? "chat-emoji-button active" : "chat-emoji-button"}
              onClick={() => {
                setEmojiOpen((value) => !value);
              }}
              title="Emoji"
              aria-label="Open emoji picker"
            >
              <Smile size={18} />
            </button>
            <button
              type="button"
              className="chat-attach"
              title="إرسال ملفات"
              onClick={() => filesInputRef.current?.click()}
            >
              <Paperclip size={17} />
            </button>
            <button
              type="button"
              className="chat-attach"
              title="إرسال مجلد"
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderOpen size={17} />
            </button>
            <input
              ref={filesInputRef}
              className="chat-hidden-file-input"
              type="file"
              multiple
              onChange={(event) => {
                chooseManagedFiles(event.target.files, "multiple_files");
                event.target.value = "";
              }}
            />
            <input
              ref={folderInputRef}
              className="chat-hidden-file-input"
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(event) => {
                chooseManagedFiles(event.target.files, "folder");
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={recording ? "chat-voice-button recording" : "chat-voice-button"}
              onClick={toggleRecording}
              disabled={voiceSending || (sending && !recording)}
              title={recording ? "Stop recording" : "Record voice message"}
            >
              {recording ? <Square size={15} /> : <Mic size={17} />}
            </button>
            <button type="submit" disabled={sending || voiceSending} title="Send">
              <Send size={17} />
            </button>
          </form>
        </section>
      )}
      {pendingDelete && (
        <div
          className="chat-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="chat-dialog">
            <strong>Delete message for everyone?</strong>
            <p>
              This message will be removed from chat for all users. This action
              cannot be undone.
            </p>
            <div className="chat-dialog-actions">
              <button type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={deleteMessage}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {seenMessage && (
        <div
          className="chat-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSeenMessage(null);
          }}
        >
          <div className="chat-dialog">
            <div className="chat-dialog-head">
              <strong>Seen by</strong>
              <button
                type="button"
                onClick={() => setSeenMessage(null)}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="chat-seen-list">
              {seenMessage.seenPeople?.length ? (
                seenMessage.seenPeople.map((mark) => (
                  <div key={`${mark.user_name}-${mark.seen_at}`}>
                    <strong>{mark.user_name}</strong>
                    <span>{chatDate(mark.seen_at)}</span>
                  </div>
                ))
              ) : (
                <span>No other users have seen it yet</span>
              )}
            </div>
          </div>
        </div>
      )}
      {folderBrowser && (
        <div
          className="chat-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFolderBrowser(null);
              setFolderEntries([]);
            }
          }}
        >
          <div className="chat-dialog chat-folder-browser">
            <div className="chat-dialog-head">
              <strong>{folderBrowser.attachment?.display_name || "Attachment folder"}</strong>
              <button
                type="button"
                onClick={() => {
                  setFolderBrowser(null);
                  setFolderEntries([]);
                }}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="chat-folder-browser-meta">
              <span>{folderBrowser.attachment?.file_count || 0} files</span>
              <span>{folderBrowser.attachment?.folder_count || 0} folders</span>
              <span>{formatBytes(folderBrowser.attachment?.total_size || 0)}</span>
            </div>
            {folderBrowser.parent && (
              <button
                type="button"
                className="chat-folder-up"
                onClick={() => openFolderBrowser(folderBrowser.attachment)}
              >
                رجوع إلى الجذر
              </button>
            )}
            <div className="chat-folder-entry-list">
              {folderLoading ? (
                <span>Loading...</span>
              ) : folderEntries.length ? (
                folderEntries.map((entry) => (
                  <div key={entry.id} className="chat-folder-entry">
                    <button
                      type="button"
                      onClick={() =>
                        entry.entry_type === "folder"
                          ? openFolderBrowser(folderBrowser.attachment, entry.id)
                          : null
                      }
                    >
                      {entry.entry_type === "folder" ? (
                        <FolderOpen size={18} />
                      ) : (
                        <FileText size={18} />
                      )}
                      <span>{entry.display_name}</span>
                    </button>
                    <small>{entry.entry_type === "file" ? formatBytes(entry.size_bytes) : "Folder"}</small>
                    {entry.download_url && (
                      <a href={buildUrl(apiBase, entry.download_url)} target="_blank" rel="noreferrer">
                        <Download size={14} /> Download
                      </a>
                    )}
                  </div>
                ))
              ) : (
                <span>No files in this folder.</span>
              )}
            </div>
          </div>
        </div>
      )}
      <ChatMediaPreview
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        setMessage={setMessage}
      />
    </div>
  );
}

function documentTypeLabel(type) {
  return (
    {
      price_offer: "عرض سعر",
      invoice: "فاتورة",
      contractor_certificate: "مستخلص مقاول",
      payment: "تحصيل",
      ledger: "كشف حساب",
    }[type] ||
    type ||
    " "
  );
}

function statusLabel(status) {
  return (
    {
      draft: "مسودة",
      approved: "معتمد",
      closed: "مغلق",
    }[status] ||
    status ||
    " "
  );
}

function summaryLabel(key) {
  return (
    {
      customer: "العميل",
      project: "المشروع",
      building_unit: "المبنى/الوحدة",
      work_type: "نوع الأعمال",
      rows: "عدد القيود",
      area_m2: "الأمتار المربعة",
      quantity: "الكمية",
      average_rate: "متوسط الفئة",
      gross_total: "الإجمالي",
      vat_amount: "ضريبة 14%",
      social_insurance_amount: "تأمينات اجتماعية",
      stamp_amount: "دمغة",
      works_insurance_amount: "تأمين أعمال",
      final_insurance_amount: "تأمين نهائي",
      contractor_tax_amount: "ضريبة مقاولات",
      net_total: "الصافي",
    }[key] || key
  );
}

const rootElement = document.getElementById("root");
window.__AM_REACT_ROOT__ =
  window.__AM_REACT_ROOT__ || createRoot(rootElement);
window.__AM_REACT_ROOT__.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
