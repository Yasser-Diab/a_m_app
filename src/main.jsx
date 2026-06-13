import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Building2,
  Check,
  ClipboardList,
  Database,
  FileDown,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Eye,
  KeyRound,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Share2,
  Smartphone,
  Sun,
  Trash2,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import hgadLogo from './assets/hgad-logo.png';
import hgadDarkLogo from './assets/sticker logo s.png';
import './styles.css';

const APP_NAME = 'Accounting Management';
const APP_MARK = 'A.M';
const APP_BYLINE = 'By Y.D';

const NAV = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: Activity },
  { id: 'offer', label: 'عروض الأسعار', icon: FileText },
  { id: 'invoice', label: 'الفواتير', icon: ReceiptText },
  { id: 'statement', label: 'كشف حساب', icon: WalletCards },
  { id: 'payments', label: 'الدفعات', icon: WalletCards },
  { id: 'contractor', label: 'المقاولين', icon: ClipboardList },
  { id: 'entry', label: 'إدخال / تعديل', icon: Plus },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

const WORKFLOWS = {
  offer: {
    label: 'عروض الأسعار غير المعتمدة',
    partyLabel: 'العميل',
    partyRole: 'customer',
    documentType: 'price_offer',
    documentStatus: 'draft',
    reportType: 'offer',
    defaultDocumentStatus: 'draft',
  },
  invoice: {
    label: 'الفواتير',
    partyLabel: 'العميل',
    partyRole: 'customer',
    documentType: 'invoice',
    reportType: 'invoice',
    defaultDocumentStatus: 'approved',
  },
  statement: {
    label: 'كشف حساب عميل',
    partyLabel: 'العميل',
    partyRole: 'customer',
    documentType: 'invoice',
    documentStatus: 'approved',
    reportType: 'statement',
    defaultDocumentStatus: 'approved',
  },
  contractor: {
    label: 'مستخلصات المقاولين',
    partyLabel: 'المقاول',
    partyRole: 'contractor',
    documentType: 'contractor_certificate',
    reportType: 'contractor',
    defaultDocumentStatus: 'approved',
  },
};

const DOCUMENT_TYPES = [
  { value: 'price_offer', label: 'عرض سعر', role: 'customer', status: 'draft' },
  { value: 'invoice', label: 'فاتورة', role: 'customer', status: 'approved' },
  { value: 'contractor_certificate', label: 'مستخلص مقاول', role: 'contractor', status: 'approved' },
];

const UNITS = [
  { value: 'sqm', label: '\u0645\u00b2' },
  { value: 'lm', label: '\u0645.\u0637' },
  { value: 'count', label: '\u0639\u062f\u062f' },
];

const TAXES = [
  { key: 'vat_enabled', label: 'ضريبة القيمة المضافة 14%' },
  { key: 'social_insurance_enabled', label: 'تأمينات اجتماعية 3.6%' },
  { key: 'stamp_enabled', label: 'دمغة هندسية 0.001' },
  { key: 'works_insurance_enabled', label: 'تأمينات أعمال 5%' },
  { key: 'final_insurance_enabled', label: 'تأمين أعمال نهائي 5%' },
  { key: 'contractor_tax_enabled', label: 'ضريبة 1%' },
];

const DEFAULT_ENTRY = {
  party_role: 'customer',
  party_category: 'retail',
  document_type: 'price_offer',
  document_status: 'draft',
  entry_date: new Date().toISOString().slice(0, 10),
  building_unit: '',
  floor_apartment: '',
  measurement_mode: 'standard',
  unit_code: 'sqm',
  item_count: 1,
  total_quantity: '',
  width_cm: '',
  height_cm: '',
  rate: '',
  vat_enabled: false,
  social_insurance_enabled: false,
  stamp_enabled: false,
  works_insurance_enabled: false,
  final_insurance_enabled: false,
  contractor_tax_enabled: false,
  discount_type: 'none',
  discount_value: '',
};

function getInitialApiBase() {
  const stored = localStorage.getItem('priceOfferApiBase');
  if (window.priceOfferDesktop?.apiBase) return window.priceOfferDesktop.apiBase;
  if (location.protocol.startsWith('http') && location.port !== '5173') return location.origin;
  if (stored !== null) return stored;
  if (location.protocol === 'file:' || location.port === '5173') return 'http://127.0.0.1:4181';
  return '';
}

function money(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatUserDateTime(value) {
  if (!value) return '-';
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
  return value === null || value === undefined || value === '' ? ' ' : String(value);
}

function statementOf(row) {
  return row.statement_text || [row.description, row.glass_spec, row.profile_spec, row.color].filter(Boolean).join('\n') || row.collection_note || '';
}

function reportHasDimensions(rows = []) {
  return rows.some((row) => row.unit_code === 'sqm' && Number(row.width_cm || 0) > 0 && Number(row.height_cm || 0) > 0);
}

function rowDimension(row, unit = 'cm') {
  if (row.unit_code !== 'sqm') return '';
  const width = Number(row.width_cm || 0);
  const height = Number(row.height_cm || 0);
  if (!width || !height) return '';
  if (unit === 'm') return `${money(width / 100)} × ${money(height / 100)} م`;
  return `${money(width)} × ${money(height)} سم`;
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 120);
}

function compactId(value) {
  return String(value || '').trim().replace(/^0+(?=\d)/, '');
}

function documentOptionText(doc = {}) {
  const id = doc.operation_no || doc.document_no || doc.id || '';
  const party = doc.customer_name || doc.display_name || doc.base_name || '';
  const project = doc.project || doc.building_unit || '';
  return [id, party, project].filter(Boolean).join(' - ');
}

function documentMatchesSearch(doc = {}, value = '') {
  const needle = compactId(value);
  if (!needle) return false;
  return [doc.operation_no, doc.document_no, doc.id]
    .some((candidate) => compactId(candidate).includes(needle));
}

function normalizeArabic(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0640/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ');
}

function lookupValues(items = []) {
  return items.map((item) => item.value || item.base_name || item.display_name || item);
}

function buildUrl(apiBase, path) {
  return `${apiBase || ''}${path}`;
}

function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function fileNameFromDisposition(header, fallback) {
  const value = header || '';
  const utf = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) return decodeURIComponent(utf[1]);
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

async function isNativeApp() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function saveNativeReport(blob, fileName) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const data = await blobToBase64(blob);
  const result = await Filesystem.writeFile({
    path: `Price offers/${fileName}`,
    data,
    directory: Directory.Documents,
    recursive: true,
  });
  return result.uri;
}

function documentTypeMeta(value) {
  return DOCUMENT_TYPES.find((item) => item.value === value) || DOCUMENT_TYPES[0];
}

function mapRowToForm(row) {
  return {
    ...DEFAULT_ENTRY,
    ...row,
    base_party_name: row.base_party_name || row.customer_name || '',
    customer_name: row.base_party_name || row.customer_name || '',
    document_type: row.accounting_status === 'فاتورة'
      ? 'invoice'
      : row.accounting_status === 'مستخلص مقاول'
        ? 'contractor_certificate'
        : 'price_offer',
    party_role: row.party_role || 'customer',
    party_category: row.party_category || 'retail',
    unit_code: row.unit_code || 'sqm',
    measurement_mode: row.measurement_mode || 'standard',
    document_status: row.document_status || 'draft',
  };
}

function App() {
  const [apiBase, setApiBaseState] = useState(getInitialApiBase);
  const [showSplash, setShowSplash] = useState(true);
  const [themeMode, setThemeMode] = useState(localStorage.getItem('priceOfferTheme') || 'system');
  const [resolvedDark, setResolvedDark] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [health, setHealth] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [lookups, setLookups] = useState({ customers: [], contractors: [], projects: [], workTypes: [], units: UNITS });
  const [terms, setTerms] = useState({ terms_retail: { sections: [] }, terms_corporate: { sections: [] } });
  const [entryForm, setEntryForm] = useState(DEFAULT_ENTRY);
  const [editingId, setEditingId] = useState(null);
  const [entryDirty, setEntryDirty] = useState(false);
  const [editorContext, setEditorContext] = useState(null);
  const [reportContexts, setReportContexts] = useState({});
  const [paymentFocus, setPaymentFocus] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('priceOfferUser') || 'null');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const dark = themeMode === 'dark'
        || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      setResolvedDark(dark);
    };
    applyTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', applyTheme);
    localStorage.setItem('priceOfferTheme', themeMode);
    return () => media.removeEventListener?.('change', applyTheme);
  }, [themeMode]);

  const api = useMemo(() => ({
    async request(path, options = {}) {
      const response = await fetch(buildUrl(apiBase, path), {
        ...options,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        let details = '';
        try {
          const raw = await response.text();
          if (raw) {
            try {
              details = JSON.parse(raw).error || raw;
            } catch {
              details = /^<!doctype html>|^<html[\s>]/i.test(raw.trim())
                ? `HTTP ${response.status}`
                : raw;
            }
          }
        } catch {
          details = '';
        }
        throw new Error(details || `HTTP ${response.status}`);
      }
      return response.json();
    },
  }), [apiBase]);

  const companyHeaderLogo = resolvedDark ? hgadDarkLogo : hgadLogo;

  const updatePlatform = useMemo(() => {
    if (window.priceOfferDesktop?.platform) return window.priceOfferDesktop.platform;
    if (/android/i.test(navigator.userAgent)) return 'android';
    if (/windows/i.test(navigator.userAgent)) return 'win32';
    return 'web';
  }, []);

  const checkForUpdates = useCallback(async (silent = true) => {
    setCheckingUpdate(true);
    try {
      const data = await api.request(`/api/update/latest?platform=${encodeURIComponent(updatePlatform)}`);
      setUpdateInfo(data);
      if (!silent && !data.updateAvailable) {
        setMessage(`Accounting Management is up to date (${data.currentVersion || health?.version || 'current'}).`);
      }
      return data;
    } catch (error) {
      setUpdateInfo({ updateAvailable: false, error: error.message });
      if (!silent) setMessage(`تعذر فحص التحديثات: ${error.message}`);
      return null;
    } finally {
      setCheckingUpdate(false);
    }
  }, [api, updatePlatform, health?.version]);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const [healthData, bootData, lookupData, termsData] = await Promise.all([
        api.request('/api/health'),
        api.request('/api/bootstrap'),
        api.request('/api/lookups'),
        api.request('/api/settings/terms'),
      ]);
      setHealth(healthData);
      setBootstrap(bootData);
      setLookups({ ...lookupData, units: UNITS });
      setTerms(termsData);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setMessage(`تعذر الاتصال بالخادم: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!currentUser) return undefined;
    checkForUpdates(true);
    const timer = window.setInterval(() => checkForUpdates(true), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [currentUser, checkForUpdates]);

  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const ping = () => {
      api.request(`/api/users/${currentUser.id}/presence`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    };
    ping();
    const timer = window.setInterval(ping, 45 * 1000);
    return () => window.clearInterval(timer);
  }, [api, currentUser?.id]);

  async function openUpdateDownload() {
    const info = updateInfo?.downloadUrl ? updateInfo : await checkForUpdates(false);
    const url = info?.downloadUrl || info?.releaseUrl;
    if (!url) return;
    if (window.priceOfferDesktop?.openExternal) {
      window.priceOfferDesktop.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setMessage(`Update ${info.latestVersion || ''} is opening for download. Run the downloaded installer/APK to complete installation.`);
  }

  function setApiBase(value) {
    const clean = cleanApiBase(value);
    setApiBaseState(clean);
    localStorage.setItem('priceOfferApiBase', clean);
  }

  async function login(credentials, apiBaseOverride = apiBase) {
    const cleanBase = cleanApiBase(apiBaseOverride);
    if (cleanBase !== apiBase) setApiBase(cleanBase);
    const response = await fetch(buildUrl(cleanBase, '/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || response.statusText || 'Login failed');
    }
    const data = await response.json();
    setCurrentUser(data.user);
    localStorage.setItem('priceOfferUser', JSON.stringify(data.user));
    localStorage.setItem('priceOfferLastUsername', credentials.username || '');
    setMessage(`تم تسجيل الدخول: ${data.user.display_name}`);
  }

  async function logout() {
    if (currentUser?.id) {
      api.request('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ user_id: currentUser.id }),
      }).catch(() => {});
    }
    setCurrentUser(null);
    localStorage.removeItem('priceOfferUser');
    setMessage('');
  }

  function requestTabChange(nextTab) {
    if (activeTab === 'entry' && entryDirty && nextTab !== 'entry') {
      const ok = window.confirm('هناك تعديل أو إضافة لم يتم حفظها. هل تريد مغادرة شاشة الإدخال؟');
      if (!ok) return;
      setEntryDirty(false);
    }
    setActiveTab(nextTab);
  }

  function updateEntryForm(next) {
    setEntryDirty(true);
    setEntryForm((current) => (typeof next === 'function' ? next(current) : next));
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

  async function refreshContextReport(context = editorContext) {
    if (!context?.workflowId) return;
    const workflow = WORKFLOWS[context.workflowId];
    if (!workflow) return;
    const query = new URLSearchParams();
    if (context.document?.id) query.set('document_id', context.document.id);
    else if (context.party?.id) query.set('party_id', context.party.id);
    if (!query.toString()) return;
    try {
      const data = await api.request(`/api/documents/${workflow.reportType}?${query.toString()}`);
      const nextContext = { ...context, reportData: data };
      setEditorContext(nextContext);
      updateReportContext(context.workflowId, { reportData: data });
    } catch {
      // Keep editing responsive even if the preview refresh fails.
    }
  }

  function workflowForDocument(doc = {}) {
    if (doc.document_type === 'statement') return 'statement';
    if (doc.document_type === 'invoice' || (doc.document_type === 'price_offer' && doc.status === 'approved')) return 'invoice';
    if (doc.document_type === 'contractor_certificate') return 'contractor';
    return 'offer';
  }

  async function openCustomerDocument(doc, party) {
    if (!doc?.id) return;
    if (doc.document_type === 'statement') {
      const workflowId = 'statement';
      const workflow = WORKFLOWS[workflowId];
      const partyObject = party || {
        id: doc.party_id,
        display_name: doc.customer_name,
        base_name: doc.customer_name,
      };
      const query = new URLSearchParams();
      if (partyObject?.id) query.set('party_id', partyObject.id);
      if (doc.project) query.set('project', doc.project);
      if (currentUser?.display_name) query.set('user_name', currentUser.display_name);
      setBusy(true);
      try {
        const reportData = await api.request(`/api/documents/${workflow.reportType}?${query.toString()}`);
        updateReportContext(workflowId, {
          workflowId,
          party: partyObject,
          document: null,
          partySearch: partyObject?.display_name || partyObject?.base_name || '',
          partyId: partyObject?.id ? String(partyObject.id) : '',
          documentId: '',
          documents: [],
          reportData,
        });
        setActiveTab('statement');
        setMessage(`تم فتح كشف حساب ${doc.project || 'عام'} للمعاينة والتصدير.`);
      } catch (error) {
        setMessage(`تعذر فتح كشف الحساب: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (doc.document_type === 'payment') {
      setPaymentFocus({
        party,
        project: doc.project || '',
        building_unit: doc.building_unit || '',
        paymentDocumentId: doc.id,
      });
      setActiveTab('payments');
      setMessage('تم فتح الدفعات لهذا العميل للمراجعة والتعديل.');
      return;
    }
    const workflowId = workflowForDocument(doc);
    const workflow = WORKFLOWS[workflowId];
    setBusy(true);
    try {
      const reportData = await api.request(`/api/documents/${workflow.reportType}?document_id=${doc.id}${currentUser?.display_name ? `&user_name=${encodeURIComponent(currentUser.display_name)}` : ''}`);
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
        partySearch: partyObject?.display_name || partyObject?.base_name || '',
        partyId: partyObject?.id ? String(partyObject.id) : '',
        documentId: String(doc.id),
        documents: [doc],
        reportData,
      });
      setEntryDirty(false);
      setActiveTab('entry');
      setMessage(`تم فتح ${documentTypeLabel(doc.document_type)} ${doc.operation_no || doc.document_no || ''} للتعديل.`);
    } catch (error) {
      setMessage(`تعذر فتح المستند للتعديل: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return undefined;
    function openFromHash() {
      if (!window.location.hash.startsWith('#open-document?')) return;
      const params = new URLSearchParams(window.location.hash.replace('#open-document?', ''));
      const id = params.get('id');
      if (!id) return;
      const type = params.get('type') || 'price_offer';
      const doc = {
        id: type === 'statement' ? id : Number(id),
        document_type: type,
        status: params.get('status') || '',
        operation_no: params.get('operation_no') || '',
        document_no: params.get('document_no') || '',
        project: params.get('project') || '',
        building_unit: params.get('building_unit') || '',
      };
      const party = params.get('party_id')
        ? {
          id: Number(params.get('party_id')),
          display_name: params.get('party_name') || '',
          base_name: params.get('party_base') || params.get('party_name') || '',
          category: params.get('party_category') || '',
        }
        : null;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      openCustomerDocument(doc, party);
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [currentUser]);

  async function saveEntry(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const method = editingId ? 'PUT' : 'POST';
      const path = editingId ? `/api/entries/${editingId}` : '/api/entries';
      await api.request(path, {
        method,
        body: JSON.stringify({
          ...entryForm,
          created_by: currentUser?.display_name,
          updated_by: currentUser?.display_name,
        }),
      });
      setEntryForm(DEFAULT_ENTRY);
      setEditingId(null);
      setEntryDirty(false);
      setMessage(editingId ? 'تم تعديل البند.' : 'تم حفظ البند.');
      await refreshAll();
      await refreshContextReport();
    } catch (error) {
      setMessage(`لم يتم الحفظ: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(id) {
    if (!window.confirm('حذف هذا البند؟')) return;
    setBusy(true);
    try {
      await api.request(`/api/entries/${id}`, { method: 'DELETE' });
      setMessage('تم حذف البند.');
      await refreshAll();
      await refreshContextReport();
    } catch (error) {
      setMessage(`لم يتم الحذف: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function editRow(row, context = null) {
    if (activeTab === 'entry' && entryDirty) {
      const ok = window.confirm('هناك تعديل أو إضافة لم يتم حفظها. هل تريد فتح بند آخر؟');
      if (!ok) return;
    }
    setEntryForm(mapRowToForm(row));
    setEditingId(row.id);
    setEditorContext(context);
    setEntryDirty(false);
    setActiveTab('entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function newRowFromContext(workflow, party, document) {
    if (activeTab === 'entry' && entryDirty) {
      const ok = window.confirm('هناك تعديل أو إضافة لم يتم حفظها. هل تريد فتح بند جديد؟');
      if (!ok) return;
    }
    const type = document?.document_type || workflow.documentType || 'price_offer';
    const meta = documentTypeMeta(type);
    setEntryForm({
      ...DEFAULT_ENTRY,
      party_role: workflow.partyRole,
      party_category: party?.category || 'retail',
      base_party_name: party?.base_name || '',
      customer_name: party?.base_name || '',
      customer_display_name: party?.display_name || '',
      search_party_name: party?.search_name || '',
      party_id: party?.id || '',
      document_id: document?.id || '',
      document_type: type,
      document_status: document?.status || meta.status,
      serial: document?.document_no || '',
      operation_no: document?.operation_no || '',
      project: document?.project || '',
      building_unit: document?.building_unit || '',
    });
    setEditingId(null);
    setEntryDirty(false);
    setEditorContext({
      workflowId: Object.entries(WORKFLOWS).find(([, item]) => item === workflow)?.[0] || 'offer',
      party,
      document,
      reportData: reportContexts[Object.entries(WORKFLOWS).find(([, item]) => item === workflow)?.[0] || 'offer']?.reportData || null,
    });
    setActiveTab('entry');
  }

  async function createBackup() {
    setBusy(true);
    try {
      const data = await api.request('/api/backup', { method: 'POST', body: JSON.stringify({}) });
      setMessage(`تم إنشاء نسخة احتياطية: ${data.backupPath}`);
    } catch (error) {
      setMessage(`تعذر إنشاء النسخة الاحتياطية: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!currentUser) {
    return (
      <>
        {showSplash && <SplashScreen />}
        <LoginView
          apiBase={apiBase}
          setApiBase={setApiBase}
          login={login}
          message={message}
          busy={busy}
        />
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
            <strong>{APP_NAME}</strong>
            <span>{APP_BYLINE}</span>
          </div>
        </div>
        <nav className="main-nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => requestTabChange(id)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="title-stack">
            <h1>{NAV.find((tab) => tab.id === activeTab)?.label}</h1>
            <span>{health?.ok ? `http://127.0.0.1:${health.port}` : 'HGAD'}</span>
          </div>
          <img className="top-logo" src={companyHeaderLogo} alt="HGAD" />
          <div className="top-actions">
            <span className="user-chip">{currentUser.display_name}</span>
            <button
              type="button"
              className={updateInfo?.updateAvailable ? 'update-chip available' : 'update-chip'}
              title={updateInfo?.updateAvailable
                ? `Update available: ${updateInfo.latestVersion}`
                : (checkingUpdate ? 'Checking for updates...' : 'Check for updates')}
              onClick={updateInfo?.updateAvailable ? openUpdateDownload : () => checkForUpdates(false)}
              disabled={checkingUpdate}
            >
              <FileDown size={16} />
              {updateInfo?.updateAvailable && <span>Update Available</span>}
            </button>
            <button className="icon-button" title="تحديث" onClick={refreshAll} disabled={busy}>
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" title="خروج" onClick={logout}>
              <LogOut size={18} />
            </button>
            <span className={health?.ok ? 'status ok' : 'status bad'}>{health?.ok ? 'متصل' : 'غير متصل'}</span>
          </div>
        </header>

        {!showSplash && busy && <LoadingOverlay />}

        {message && (
          <div className="notice">
            <span>{message}</span>
            <button type="button" className="notice-close" title="إغلاق التنبيه" onClick={() => setMessage('')}>×</button>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <Dashboard
            api={api}
            apiBase={apiBase}
            currentUser={currentUser}
            bootstrap={bootstrap}
            refreshKey={refreshKey}
            setMessage={setMessage}
            onOpenDocument={openCustomerDocument}
            onEditRow={editRow}
            onDeleteRow={deleteEntry}
            onNewRow={newRowFromContext}
            context={reportContexts.offer}
            setContext={(patch) => updateReportContext('offer', patch)}
          />
        )}
        {activeTab === 'offer' && (
          <ReportWorkspace
            workflowId="offer"
            locked
            api={api}
            apiBase={apiBase}
            currentUser={currentUser}
            refreshKey={refreshKey}
            setMessage={setMessage}
            onEditRow={editRow}
            onDeleteRow={deleteEntry}
            onNewRow={newRowFromContext}
            context={reportContexts.offer}
            setContext={(patch) => updateReportContext('offer', patch)}
          />
        )}
        {activeTab === 'invoice' && (
          <ReportWorkspace
            workflowId="invoice"
            locked
            api={api}
            apiBase={apiBase}
            currentUser={currentUser}
            refreshKey={refreshKey}
            setMessage={setMessage}
            onEditRow={editRow}
            onDeleteRow={deleteEntry}
            onNewRow={newRowFromContext}
            context={reportContexts.invoice}
            setContext={(patch) => updateReportContext('invoice', patch)}
          />
        )}
        {activeTab === 'statement' && (
          <ReportWorkspace
            workflowId="statement"
            locked
            api={api}
            apiBase={apiBase}
            currentUser={currentUser}
            refreshKey={refreshKey}
            setMessage={setMessage}
            onEditRow={editRow}
            onDeleteRow={deleteEntry}
            onNewRow={newRowFromContext}
            context={reportContexts.statement}
            setContext={(patch) => updateReportContext('statement', patch)}
          />
        )}
        {activeTab === 'contractor' && (
          <ReportWorkspace
            workflowId="contractor"
            locked
            api={api}
            apiBase={apiBase}
            currentUser={currentUser}
            refreshKey={refreshKey}
            setMessage={setMessage}
            onEditRow={editRow}
            onDeleteRow={deleteEntry}
            onNewRow={newRowFromContext}
            context={reportContexts.contractor}
            setContext={(patch) => updateReportContext('contractor', patch)}
          />
        )}
        {activeTab === 'payments' && (
          <PaymentsView
            api={api}
            lookups={lookups}
            currentUser={currentUser}
            refreshKey={refreshKey}
            setMessage={setMessage}
            refreshAll={refreshAll}
            focus={paymentFocus}
          />
        )}
        {activeTab === 'entry' && (
          <EntryEditor
            api={api}
            lookups={lookups}
            entryForm={entryForm}
            setEntryForm={updateEntryForm}
            editingId={editingId}
            setEditingId={setEditingId}
            saveEntry={saveEntry}
            editorContext={editorContext}
            onEditRow={editRow}
            onDeleteRow={deleteEntry}
            setMessage={setMessage}
            onCloseContext={() => {
              if (entryDirty && !window.confirm('هناك تعديل أو إضافة لم يتم حفظها. هل تريد إغلاق التقرير المرتبط؟')) return;
              setEditorContext(null);
            }}
            onBack={() => {
              if (entryDirty && !window.confirm('هناك تعديل أو إضافة لم يتم حفظها. هل تريد الرجوع؟')) return;
              setEditorContext(null);
              setEditingId(null);
              setEntryDirty(false);
              setActiveTab('dashboard');
            }}
            busy={busy}
            currentUser={currentUser}
            refreshAll={refreshAll}
          />
        )}
        {activeTab === 'settings' && (
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
            createBackup={createBackup}
            setMessage={setMessage}
            busy={busy}
          />
        )}
        </section>
      </main>
    </>
  );
}

function AppBrandMark({ small = false }) {
  return (
    <div className={small ? 'am-brand-mark small' : 'am-brand-mark'} dir="ltr" aria-label={`${APP_MARK} ${APP_BYLINE}`}>
      <span className="brand-digit-cloud" aria-hidden="true">
        {'0123456789'.split('').map((digit, index) => (
          <span key={`${digit}-${index}`} style={{ '--digit-index': index }}>{digit}</span>
        ))}
      </span>
      <strong>
        <span className="am-a">A</span><span className="am-dot">.</span><span className="am-m">M</span>
      </strong>
      <small>{APP_BYLINE}</small>
    </div>
  );
}

function readyCountClass(count) {
  if (!count) return 'zero';
  if (count < 10) return 'blue';
  if (count < 20) return 'green';
  return `wheel-${Math.floor(count / 10) % 6}`;
}

function ItemReadyBadge({ count, suffix = 'بند جاهز' }) {
  return (
    <span className={`ready-count ${readyCountClass(count)}`} title={`${count} ${suffix}`}>
      <strong>{count}</strong>
      <span>{suffix}</span>
    </span>
  );
}

function DocumentIdSearch({
  api,
  type = '',
  status = '',
  value,
  onChange,
  onSelect,
  title = 'Search by document ID',
  placeholder = 'ID / رقم مستند',
}) {
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(false);
  const query = String(value || '').trim();
  const visibleItems = items.slice(0, 8);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!query) {
        setItems([]);
        return;
      }
      const params = new URLSearchParams({ q: query });
      if (type) params.set('type', type);
      if (status) params.set('status', status);
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
            if (event.key === 'Enter' && visibleItems.length) {
              event.preventDefault();
              const exact = visibleItems.find((doc) => documentMatchesSearch(doc, query));
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
              <button key={doc.id} type="button" onMouseDown={() => choose(doc)}>
                <strong>{doc.operation_no || doc.document_no || doc.id}</strong>
                <span>{[doc.customer_name || doc.display_name, doc.project].filter(Boolean).join(' - ')}</span>
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
    <div className={compact ? 'loading-overlay compact-loading' : 'loading-overlay'} dir="ltr" aria-label="Loading">
      <AppBrandMark small />
      <span className="splash-title">Loading</span>
    </div>
  );
}

function LoginView({ apiBase, setApiBase, login, message, busy }) {
  const [name, setName] = useState(() => localStorage.getItem('priceOfferLastUsername') || '');
  const [password, setPassword] = useState('');
  const [draftApi, setDraftApi] = useState(apiBase);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const nextApi = cleanApiBase(draftApi);
      setApiBase(nextApi);
      await login({ username: name, password }, nextApi);
    } catch (loginError) {
      setError(`تعذر تسجيل الدخول: ${loginError.message}`);
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
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="username" />
          </Field>
          <Field label="كلمة المرور">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Server URL">
            <div className="inline-field">
              <input dir="ltr" value={draftApi} onChange={(event) => setDraftApi(event.target.value)} />
              <button type="button" onClick={() => setApiBase(draftApi)}>
                <Server size={16} />
              </button>
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

function Dashboard(props) {
  const { bootstrap, api, setMessage, onOpenDocument } = props;
  const summary = bootstrap?.summary || {};
  const metrics = [
    ['القيد', summary.rows],
    ['المستند', summary.documents],
    ['عميل/مقاول', summary.customers],
    ['عروض أسعار', summary.offers_total],
    ['فواتير', summary.invoices_total],
    ['مقاولين', summary.contractor_total],
  ];

  return (
    <div className="page-stack">
      <section className="metric-grid">
        {metrics.map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{money(value)}</strong>
          </div>
        ))}
      </section>
      <CustomerExplorer api={api} setMessage={setMessage} onOpenDocument={onOpenDocument} />
      <h2 className="section-title">استخراج تقرير</h2>
      <ReportWorkspace {...props} workflowId="offer" compact />
      <section className="panel">
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
              {(bootstrap?.docs || []).map((row) => (
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
    </div>
  );
}

function CustomerExplorer({ api, setMessage, onOpenDocument }) {
  const [search, setSearch] = useState('');
  const [documentSearch, setDocumentSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [partyId, setPartyId] = useState('');
  const [overview, setOverview] = useState(null);
  const selectedCustomer = customers.find((customer) => String(customer.id) === String(partyId));

  useEffect(() => {
    let cancelled = false;
    async function loadCustomers() {
      try {
        const query = new URLSearchParams({ role: 'customer' });
        if (search) query.set('q', search);
        const data = await api.request(`/api/parties?${query.toString()}`);
        if (!cancelled) {
          setCustomers(data || []);
          const idSearch = String(search || '').trim();
          if (idSearch && /^\d+/.test(idSearch) && data?.length === 1) {
            setPartyId(String(data[0].id));
          }
        }
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل العملاء: ${error.message}`);
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
      if (partyId) query.set('party_id', partyId);
      else if (search.trim()) query.set('name', search.trim());
      else {
        setOverview(null);
        return;
      }
      try {
        const data = await api.request(`/api/customer-overview?${query.toString()}`);
        if (!cancelled) setOverview(data);
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل بيانات العميل: ${error.message}`);
      }
    }
    loadOverview();
    return () => {
      cancelled = true;
    };
  }, [api, partyId, search, setMessage]);

  const docLine = (doc) => `${doc.operation_no || doc.document_no || '-'} · ${doc.project || 'بدون مشروع'} · ${money(doc.net_total || doc.paid_total || 0)}`;
  function activateDoc(doc, payment = false) {
    setMessage(`جاري فتح ${payment ? 'التحصيل' : documentTypeLabel(doc.document_type)} ${doc.operation_no || doc.document_no || ''}...`);
    onOpenDocument?.(doc, overview?.party);
  }

  function openDocHref(doc = {}) {
    const params = new URLSearchParams({
      id: String(doc.id || ''),
      type: doc.document_type || '',
      status: doc.status || '',
      operation_no: doc.operation_no || '',
      document_no: String(doc.document_no || ''),
      project: doc.project || '',
      building_unit: doc.building_unit || '',
      party_id: String(overview?.party?.id || ''),
      party_name: overview?.party?.display_name || overview?.party?.base_name || '',
      party_base: overview?.party?.base_name || '',
      party_category: overview?.party?.category || '',
    });
    return `#open-document?${params.toString()}`;
  }

  const openDocButton = (doc, { payment = false } = {}) => (
    <a
      href={openDocHref(doc)}
      className={payment ? 'tree-link payment-link' : 'tree-link'}
      title="افتح هذا البند للمراجعة أو التعديل"
      onClick={(event) => {
        event.preventDefault();
        activateDoc(doc, payment);
      }}
    >
      <span>{payment ? `تحصيل - ${doc.operation_no || doc.document_no || '-'} · ${doc.project || 'عام'} · ${money(doc.paid_total)}` : docLine(doc)}</span>
      <small>{payment ? 'تحصيل' : statusLabel(doc.status)}</small>
    </a>
  );

  const openStatementButton = (row) => {
    const doc = {
      id: `statement-${row.project || 'global'}`,
      document_type: 'statement',
      status: 'approved',
      project: row.project || '',
      party_id: overview?.party?.id,
      customer_name: overview?.party?.display_name || overview?.party?.base_name || '',
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
        <span>{row.project || 'عام'} · الرصيد {money(row.balance)}</span>
        <small>فواتير معتمدة + تحصيل</small>
      </a>
    );
  };

  return (
    <section className="panel customer-explorer" title="بحث شامل عن كل بيانات العميل من قاعدة البيانات">
      <div className="panel-head">
        <h2>بحث بيانات عميل</h2>
        {overview?.party && <span className="user-chip">ID {overview.party.id}</span>}
      </div>
      <div className="customer-search-row">
        <DocumentIdSearch
          api={api}
          value={documentSearch}
          onChange={setDocumentSearch}
          onSelect={(doc) => {
            const party = {
              id: doc.party_id,
              display_name: doc.customer_name || doc.display_name || '',
              base_name: doc.base_name || doc.customer_name || doc.display_name || '',
            };
            setSearch(party.display_name || '');
            if (party.id) setPartyId(String(party.id));
            onOpenDocument?.(doc, party);
          }}
          title="اكتب رقم المستند أو ID لفتح المستند مباشرة"
        />
        <Field label="اكتب أو اختر العميل">
          <input
            value={search}
            list="dashboardCustomers"
            onChange={(event) => {
              setSearch(event.target.value);
              const matched = customers.find((customer) => customer.display_name === event.target.value || customer.base_name === event.target.value);
              setPartyId(matched?.id ? String(matched.id) : '');
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
              const party = customers.find((customer) => String(customer.id) === event.target.value);
              if (party) setSearch(party.display_name || party.base_name || '');
            }}
            title="اختيار عميل من قاعدة العملاء"
          >
            <option value="">--</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.display_name}</option>
            ))}
          </select>
        </Field>
      </div>
      <datalist id="dashboardCustomers">
        {customers.map((customer) => <option key={customer.id} value={customer.display_name || customer.base_name} />)}
      </datalist>
      {overview?.party ? (
        <div className="customer-tree">
          <details open>
            <summary>Projects</summary>
            {(overview.projects || []).map((project) => (
              <details open key={project.name || 'بدون مشروع'}>
                <summary>{project.name || 'بدون مشروع'} <span>{money(project.total)}</span></summary>
                <ul>
                  {(project.documents || []).map((doc) => (
                    <li key={doc.id}>
                      {openDocButton(doc)}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </details>
          <details open>
            <summary>Price offers</summary>
            <ul>{(overview.priceOffers || []).map((doc) => <li key={doc.id}>{openDocButton(doc)}</li>)}</ul>
          </details>
          <details open>
            <summary>Invoices</summary>
            <ul>{(overview.invoices || []).map((doc) => <li key={doc.id}>{openDocButton(doc)}</li>)}</ul>
          </details>
          <details open>
            <summary>Payments</summary>
            <ul>{(overview.payments || []).map((doc) => <li key={doc.id}>{openDocButton(doc, { payment: true })}</li>)}</ul>
          </details>
          <details open>
            <summary>Statements</summary>
            <ul>{(overview.statements || []).map((row) => <li key={row.project || 'global'}>{openStatementButton(row)}</li>)}</ul>
          </details>
        </div>
      ) : (
        <div className="empty-state tight">{selectedCustomer ? 'لا توجد بيانات مرتبطة بعد' : 'اختر عميل لعرض الشجرة'}</div>
      )}
    </section>
  );
}

function ReportWorkspace({
  workflowId,
  locked = false,
  compact = false,
  api,
  apiBase,
  currentUser,
  refreshKey,
  setMessage,
  onEditRow,
  onDeleteRow,
  onNewRow,
  context = {},
  setContext = () => {},
}) {
  const [currentWorkflow, setCurrentWorkflow] = useState(workflowId);
  const workflow = WORKFLOWS[currentWorkflow];
  const [partySearch, setPartySearch] = useState(context.partySearch || '');
  const [documentSearch, setDocumentSearch] = useState(context.documentSearch || '');
  const [parties, setParties] = useState([]);
  const [documents, setDocuments] = useState(context.documents || []);
  const [partyId, setPartyId] = useState(context.partyId || '');
  const [documentId, setDocumentId] = useState(context.documentId || '');
  const [projectFilter, setProjectFilter] = useState(context.projectFilter || '');
  const [workTypeFilter, setWorkTypeFilter] = useState(context.workTypeFilter || '');
  const [certificateFilter, setCertificateFilter] = useState(context.certificateFilter || '');
  const [reportData, setReportData] = useState(context.reportData || null);
  const [contractorRows, setContractorRows] = useState([]);
  const [documentDraft, setDocumentDraft] = useState({ status: 'draft', discount_type: 'none', discount_value: 0 });
  const [dimensionUnit, setDimensionUnit] = useState(context.dimensionUnit || 'cm');
  const [subtotalMode, setSubtotalMode] = useState(context.subtotalMode || 'none');
  const [previewUrl, setPreviewUrl] = useState(context.previewUrl || '');
  const [previewKey, setPreviewKey] = useState(context.previewKey || '');
  const [busy, setBusy] = useState(false);
  const isStatementWorkflow = currentWorkflow === 'statement';
  const canRunReport = isStatementWorkflow ? !!partyId : (!!partyId || !!documentId);

  useEffect(() => {
    setCurrentWorkflow(workflowId);
  }, [workflowId]);

  useEffect(() => {
    if (context?.workflowId === currentWorkflow) return;
    setPartyId('');
    setDocumentId('');
    setProjectFilter('');
    setWorkTypeFilter('');
    setCertificateFilter('');
    setDocumentSearch('');
    setDocuments([]);
    setReportData(null);
  }, [currentWorkflow]);

  useEffect(() => {
    let cancelled = false;
    async function loadParties() {
      const query = new URLSearchParams({ role: workflow.partyRole });
      if (workflow.documentType) query.set('document_type', workflow.documentType);
      if (workflow.documentStatus) query.set('document_status', workflow.documentStatus);
      if (partySearch) query.set('q', partySearch);
      try {
        const data = await api.request(`/api/parties?${query.toString()}`);
        if (!cancelled) {
          setParties(data);
          const idSearch = String(partySearch || '').trim();
          if (idSearch && /^\d+/.test(idSearch) && data.length === 1 && String(data[0].id) !== String(partyId)) {
            setPartyId(String(data[0].id));
            setDocumentId('');
            setContext({ partyId: String(data[0].id), documentId: '' });
          }
        }
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل القائمة: ${error.message}`);
      }
    }
    loadParties();
    return () => {
      cancelled = true;
    };
  }, [api, workflow.partyRole, workflow.documentType, workflow.documentStatus, partySearch, partyId, refreshKey, setMessage]);

  useEffect(() => {
    let cancelled = false;
    async function loadDocuments() {
      if (!partyId) {
        setDocuments([]);
        return;
      }
      const query = new URLSearchParams({ party_id: partyId });
      if (workflow.documentType) query.set('type', workflow.documentType);
      if (workflow.documentStatus) query.set('status', workflow.documentStatus);
      try {
        const data = await api.request(`/api/documents?${query.toString()}`);
        if (!cancelled) {
          setDocuments(data);
          const searchText = String(partySearch || '').trim();
          const matchedBySearch = searchText
            ? data.find((item) => [item.id, item.document_no, item.operation_no].some((value) => String(value || '').includes(searchText)))
            : null;
          const nextDocumentId = isStatementWorkflow
            ? ''
            : (matchedBySearch?.id
              ? String(matchedBySearch.id)
              : (data.some((item) => String(item.id) === String(documentId)) ? documentId : (data[0]?.id ? String(data[0].id) : '')));
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
  }, [api, partyId, workflow.documentType, workflow.documentStatus, partySearch, refreshKey, setMessage, isStatementWorkflow]);

  const selectedParty = parties.find((item) => String(item.id) === String(partyId));
  const selectedDocument = documents.find((item) => String(item.id) === String(documentId));
  const isContractorWorkflow = currentWorkflow === 'contractor';
  const projectOptions = uniqueValues([
    ...documents.map((doc) => doc.project),
    ...contractorRows.map((row) => row.project),
  ]);
  const contractorWorkOptions = uniqueValues([
    ...(reportData?.rows || []).map((row) => row.work_type),
    ...contractorRows.map((row) => row.work_type),
  ]);
  const contractorCertificateOptions = uniqueValues([
    ...(reportData?.rows || []).map((row) => row.certificate_no),
    ...contractorRows.map((row) => row.certificate_no),
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadContractorRows() {
      if (!isContractorWorkflow || !partyId) {
        setContractorRows([]);
        return;
      }
      try {
        const params = new URLSearchParams({ party_id: partyId, limit: '500' });
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
    const nextPartyId = doc.party_id ? String(doc.party_id) : '';
    setDocumentSearch(documentOptionText(doc));
    setPartySearch(doc.customer_name || doc.display_name || '');
    setPartyId(nextPartyId);
    setDocuments((current) => (current.some((item) => String(item.id) === String(doc.id)) ? current : [doc, ...current]));
    if (isStatementWorkflow) {
      setDocumentId('');
      setProjectFilter(doc.project || '');
      setContext({
        documentSearch: documentOptionText(doc),
        partySearch: doc.customer_name || doc.display_name || '',
        partyId: nextPartyId,
        documentId: '',
        projectFilter: doc.project || '',
      });
      return;
    }
    setDocumentId(String(doc.id));
    setProjectFilter(doc.project || '');
    setContext({
      documentSearch: documentOptionText(doc),
      partySearch: doc.customer_name || doc.display_name || '',
      partyId: nextPartyId,
      documentId: String(doc.id),
      projectFilter: doc.project || '',
      documents: [doc, ...documents.filter((item) => String(item.id) !== String(doc.id))],
    });
  }

  useEffect(() => {
    if (selectedDocument) {
      setDocumentDraft({
        status: selectedDocument.status || workflow.defaultDocumentStatus,
        discount_type: selectedDocument.discount_type || 'none',
        discount_value: selectedDocument.discount_value || 0,
        project: selectedDocument.project || '',
        building_unit: selectedDocument.building_unit || '',
      });
    }
  }, [selectedDocument, workflow.defaultDocumentStatus]);

  function reportQuery() {
    const query = new URLSearchParams();
    if (isStatementWorkflow) {
      if (partyId) query.set('party_id', partyId);
      if (projectFilter) query.set('project', projectFilter);
    } else if (documentId) {
      query.set('document_id', documentId);
    } else if (partyId) {
      query.set('party_id', partyId);
    }
    if (isContractorWorkflow) {
      if (projectFilter) query.set('project', projectFilter);
      if (workTypeFilter) query.set('work_type', workTypeFilter);
      if (certificateFilter) query.set('certificate_no', certificateFilter);
    }
    query.set('dimension_unit', dimensionUnit);
    query.set('subtotal_mode', subtotalMode);
    if (currentUser?.display_name) query.set('user_name', currentUser.display_name);
    return query;
  }

  function reportQueryObject() {
    return Object.fromEntries(reportQuery().entries());
  }

  function currentPreviewKey() {
    return `${workflow.reportType}?${reportQuery().toString()}`;
  }

  function showExportPreview() {
    if (!canRunReport) return;
    const key = currentPreviewKey();
    const url = buildUrl(apiBase, `/api/documents/${workflow.reportType}/html?${reportQuery().toString()}`);
    setPreviewUrl(url);
    setPreviewKey(key);
    setContext({ previewUrl: url, previewKey: key });
    setMessage('تم تجهيز معاينة التقرير. راجعها ثم اضغط PDF أو Excel XLSX للحفظ.');
  }

  async function loadReport() {
    if (!canRunReport) return;
    setBusy(true);
    try {
      const data = await api.request(`/api/documents/${workflow.reportType}?${reportQuery().toString()}`);
      setReportData(data);
      setContext({
        workflowId: currentWorkflow,
        partySearch,
        documentSearch,
        partyId,
        documentId,
        projectFilter,
        workTypeFilter,
        certificateFilter,
        documents,
        reportData: data,
        dimensionUnit,
        subtotalMode,
        party: selectedParty,
        document: selectedDocument,
      });
    } catch (error) {
      setMessage(`تعذر تجهيز التقرير: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument() {
    if (!selectedDocument) return;
    if (String(documentDraft.status || '') !== String(selectedDocument.status || '') && !canUser(currentUser, 'can_change_status')) {
      setMessage('هذا المستخدم غير مسموح له بتغيير حالة المستند.');
      return;
    }
    setBusy(true);
    try {
      await api.request(`/api/documents/${selectedDocument.id}`, {
        method: 'PUT',
        body: JSON.stringify(documentDraft),
      });
      setMessage('تم حفظ بيانات المستند.');
      await loadReport();
    } catch (error) {
      setMessage(`لم يتم حفظ بيانات المستند: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportReport(kind, options = {}) {
    if (!canRunReport) return;
    setBusy(true);
    try {
      const extension = kind === 'pdf' ? 'pdf' : 'xlsx';
      const response = await fetch(buildUrl(apiBase, `/api/documents/${workflow.reportType}/${extension}?${reportQuery().toString()}`));
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || response.statusText || 'Export failed');
      }
      const blob = await response.blob();
      const fileName = fileNameFromDisposition(
        response.headers.get('Content-Disposition'),
        `${workflow.label}.${extension}`,
      );
      if (await isNativeApp()) {
        const uri = await saveNativeReport(blob, fileName);
        if (options.share && extension === 'pdf') {
          const { Share } = await import('@capacitor/share');
          await Share.share({ title: fileName, url: uri, dialogTitle: 'Share report' });
          setMessage(`تم فتح نافذة مشاركة PDF: ${fileName}`);
          return;
        }
        setMessage(`تم حفظ الملف على هذا الجهاز داخل مجلد Price offers: ${fileName}`);
        return;
      }
      if (options.share && extension === 'pdf') {
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ files: [file], title: fileName });
          setMessage(`تم فتح نافذة مشاركة PDF: ${fileName}`);
          return;
        }
        downloadBlob(blob, fileName);
        setMessage(`المشاركة غير مدعومة هنا، تم تنزيل PDF على هذا الجهاز: ${fileName}`);
        return;
      }
      downloadBlob(blob, fileName);
      setMessage(`تم تنزيل ${kind === 'pdf' ? 'PDF' : 'Excel XLSX'} على هذا الجهاز: ${fileName}`);
    } catch (error) {
      setMessage(`تعذر تصدير الملف: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={compact ? 'panel report-workspace compact-workflow' : 'panel report-workspace'}>
      {busy && <LoadingOverlay compact />}
      <div className="panel-head">
        <h2>{workflow.label}</h2>
        {!locked && (
          <select value={currentWorkflow} onChange={(event) => setCurrentWorkflow(event.target.value)}>
            {Object.entries(WORKFLOWS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
          </select>
        )}
      </div>

      <div className="chain-grid">
        <DocumentIdSearch
          api={api}
          type={isStatementWorkflow ? '' : workflow.documentType}
          status={workflow.documentStatus || ''}
          value={documentSearch}
          onChange={(value) => {
            setDocumentSearch(value);
            setContext({ documentSearch: value });
          }}
          onSelect={applySearchedDocument}
          title="اكتب رقم المستند أو ID للانتقال إليه مباشرة داخل هذا القسم"
        />
        <Field label={`${workflow.partyLabel} - بحث`}>
          <div className="inline-field">
            <Search size={16} />
            <input value={partySearch} onChange={(event) => {
              setPartySearch(event.target.value);
              setContext({ partySearch: event.target.value });
            }} placeholder={workflow.partyLabel} />
          </div>
        </Field>
        <Field label={workflow.partyLabel}>
          <select value={partyId} onChange={(event) => {
            setPartyId(event.target.value);
            setDocumentId('');
            setProjectFilter('');
            setReportData(null);
            setContext({ partyId: event.target.value, documentId: '', projectFilter: '', reportData: null });
          }}>
            <option value="">--</option>
            {parties.map((party) => <option key={party.id} value={party.id}>{party.display_name}</option>)}
          </select>
        </Field>
        {isStatementWorkflow ? (
          <ComboField
            label="المشروع (اختياري)"
            value={projectFilter}
            options={projectOptions}
            onChange={(value) => {
              setProjectFilter(value);
              setDocumentId('');
              setContext({ projectFilter: value, documentId: '' });
            }}
          />
        ) : (
          <Field label="رقم / مستند">
            <select value={documentId} onChange={(event) => {
              setDocumentId(event.target.value);
              setContext({ documentId: event.target.value });
            }}>
              <option value="">كل مستندات المحدد</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.operation_no} - {doc.project || doc.title || documentTypeLabel(doc.document_type)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isContractorWorkflow && (
          <>
            <ComboField
              label="المشروع (اختياري)"
              value={projectFilter}
              options={projectOptions}
              onChange={(value) => {
                setProjectFilter(value);
                setDocumentId('');
                setContext({ projectFilter: value, documentId: '' });
              }}
            />
            <ComboField
              label="نوع الأعمال (اختياري)"
              value={workTypeFilter}
              options={contractorWorkOptions}
              onChange={(value) => {
                setWorkTypeFilter(value);
                setDocumentId('');
                setContext({ workTypeFilter: value, documentId: '' });
              }}
            />
            <ComboField
              label="رقم المستخلص (اختياري)"
              value={certificateFilter}
              options={contractorCertificateOptions}
              onChange={(value) => {
                setCertificateFilter(value);
                setDocumentId('');
                setContext({ certificateFilter: value, documentId: '' });
              }}
            />
          </>
        )}
        <div className="action-row">
          {(currentWorkflow === 'offer' || currentWorkflow === 'invoice') && (
            <button type="button" className="tiny-toggle" title="تبديل ظهور المقاسات بين سنتيمتر ومتر" onClick={() => {
              const next = dimensionUnit === 'cm' ? 'm' : 'cm';
              setDimensionUnit(next);
            setContext({ dimensionUnit: next });
            }}>
              المقاس: {dimensionUnit === 'cm' ? 'سم' : 'م'}
            </button>
          )}
          {(currentWorkflow === 'offer' || currentWorkflow === 'invoice' || currentWorkflow === 'contractor') && (
            <>
              <button type="button" title="إظهار أو إخفاء إجماليات المواقع" className={subtotalMode === 'building' ? 'tiny-toggle active' : 'tiny-toggle'} onClick={() => {
                const next = subtotalMode === 'building' ? 'none' : 'building';
                setSubtotalMode(next);
                setContext({ subtotalMode: next });
              }}>
                إجماليات مواقع
              </button>
              <button type="button" title="إظهار أو إخفاء إجماليات الوحدات" className={subtotalMode === 'unit' ? 'tiny-toggle active' : 'tiny-toggle'} onClick={() => {
                const next = subtotalMode === 'unit' ? 'none' : 'unit';
                setSubtotalMode(next);
                setContext({ subtotalMode: next });
              }}>
                إجماليات وحدات
              </button>
            </>
          )}
          {currentWorkflow !== 'statement' && (
            <button title="إضافة بند جديد لهذا العميل أو المستند" onClick={() => onNewRow(workflow, selectedParty, selectedDocument)} disabled={!selectedParty}>
              <Plus size={18} /> بند
            </button>
          )}
          <button className="primary" title="عرض التقرير المحدد داخل التطبيق" onClick={loadReport} disabled={busy || !canRunReport}>
            <Search size={18} /> عرض
          </button>
          <button title="فتح معاينة التقرير قبل التصدير" onClick={showExportPreview} disabled={!canRunReport}>
            <Eye size={18} /> معاينة PDF
          </button>
          <button title="تنزيل PDF على هذا الجهاز" onClick={() => exportReport('pdf')} disabled={!canRunReport}>
            <FileDown size={18} /> PDF
          </button>
          <button title="تصدير PDF ثم فتح نافذة المشاركة" onClick={() => exportReport('pdf', { share: true })} disabled={!canRunReport}>
            <Share2 size={18} /> مشاركة
          </button>
          <button title="تنزيل ملف Excel XLSX منسق" onClick={() => exportReport('xlsx')} disabled={!canRunReport}>
            <FileSpreadsheet size={18} /> Excel XLSX
          </button>
        </div>
      </div>

      {selectedDocument && currentWorkflow !== 'statement' && (
        <div className="document-strip">
          <Field label="الحالة">
            <select value={documentDraft.status} disabled={!canUser(currentUser, 'can_change_status')} onChange={(event) => setDocumentDraft({ ...documentDraft, status: event.target.value })}>
              <option value="draft">مسودة</option>
              <option value="approved">معتمد</option>
              <option value="closed">مغلق</option>
            </select>
          </Field>
          <Field label="نوع الخصم">
            <select value={documentDraft.discount_type} onChange={(event) => setDocumentDraft({ ...documentDraft, discount_type: event.target.value })}>
              <option value="none">بدون</option>
              <option value="rate">نسبة</option>
              <option value="amount">مبلغ</option>
            </select>
          </Field>
          <Field label="قيمة الخصم">
            <input type="number" step="0.01" value={documentDraft.discount_value} onChange={(event) => setDocumentDraft({ ...documentDraft, discount_value: event.target.value })} />
          </Field>
          <button onClick={saveDocument} disabled={busy}>
            <Save size={18} /> حفظ المستند
          </button>
        </div>
      )}

      <DocumentPreview
        data={reportData}
        dimensionUnit={dimensionUnit}
        onEditRow={(row) => onEditRow(row, {
          workflowId: currentWorkflow,
          party: selectedParty,
          document: selectedDocument,
          reportData,
        })}
        onDeleteRow={onDeleteRow}
        compact={compact}
      />
      {previewUrl && (
        <section className="export-preview">
          <div className="panel-head">
            <h2>معاينة التصدير</h2>
            <button type="button" onClick={() => {
              setPreviewUrl('');
              setPreviewKey('');
              setContext({ previewUrl: '', previewKey: '' });
            }}>إغلاق المعاينة</button>
          </div>
          <div className="preview-frame-wrap">
            <iframe title="Export preview" src={previewUrl} />
          </div>
        </section>
      )}
    </section>
  );
}

function PaymentsView({ api, lookups, currentUser, refreshKey, setMessage, refreshAll, focus }) {
  const [form, setForm] = useState({
    party_category: 'retail',
    base_party_name: '',
    project: '',
    building_unit: '',
    amount: '',
    entry_date: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [recent, setRecent] = useState([]);
  const [paymentCustomers, setPaymentCustomers] = useState([]);
  const [reviewCustomer, setReviewCustomer] = useState('');
  const [related, setRelated] = useState({ projects: [], buildings: [] });
  const [editingPayment, setEditingPayment] = useState(null);
  const [appliedFocusKey, setAppliedFocusKey] = useState('');
  const [busy, setBusy] = useState(false);
  const customerNames = uniqueValues((lookups.customers || [])
    .filter((party) => form.party_category === 'unselected' || !form.party_category || party.category === form.party_category)
    .map((party) => party.base_name || party.display_name));
  const paymentCustomerNames = uniqueValues(paymentCustomers.map((row) => row.base_name || row.display_name));
  const selectedCustomerKey = normalizeArabic(form.base_party_name);
  const selectedReviewCustomerKey = normalizeArabic(reviewCustomer);
  const paymentRowName = (row) => String(row.base_party_name || row.customer_name || row.customer_display_name || row.party_display_name || '');
  const relatedRecent = recent.filter((row) => {
    const typed = selectedCustomerKey;
    const rowName = normalizeArabic(paymentRowName(row));
    return typed && rowName.includes(typed);
  });
  const projectOptions = uniqueValues([...(related.projects || []), ...relatedRecent.map((row) => row.project)]);
  const buildingOptions = uniqueValues([...(related.buildings || []), ...relatedRecent.filter((row) => !form.project || row.project === form.project).map((row) => row.building_unit)]);
  const reviewPayments = selectedReviewCustomerKey
    ? recent.filter((row) => normalizeArabic(paymentRowName(row)).includes(selectedReviewCustomerKey))
    : recent;
  const visiblePayments = reviewPayments
    .filter((row) => !form.project || row.project === form.project)
    .filter((row) => !form.building_unit || row.building_unit === form.building_unit);

  useEffect(() => {
    if (!focus) return;
    const key = [
      focus.party?.id || focus.party?.base_name || focus.party?.display_name || '',
      focus.project || '',
      focus.building_unit || '',
      focus.paymentDocumentId || '',
    ].join('|');
    if (!key || key === appliedFocusKey) return;
    setAppliedFocusKey(key);
    const partyName = focus.party?.base_name || focus.party?.display_name || '';
    setEditingPayment(null);
    setReviewCustomer(partyName);
    setForm((current) => ({
      ...current,
      party_category: focus.party?.category || current.party_category || 'unselected',
      base_party_name: partyName,
      project: focus.project || '',
      building_unit: focus.building_unit || '',
    }));
  }, [focus, appliedFocusKey]);

  useEffect(() => {
    if (!focus?.paymentDocumentId || !recent.length) return;
    const matched = recent.find((row) => String(row.document_id) === String(focus.paymentDocumentId));
    if (matched && editingPayment?.id !== matched.id) editPayment(matched);
  }, [focus, recent, editingPayment?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadPayments() {
      try {
        const data = await api.request('/api/payments?limit=2000');
        if (!cancelled) setRecent(data.rows || []);
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل الدفعات: ${error.message}`);
      }
    }
    loadPayments();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, setMessage]);

  useEffect(() => {
    let cancelled = false;
    async function loadPaymentCustomers() {
      try {
        const data = await api.request('/api/payment-customers');
        if (!cancelled) setPaymentCustomers(data || []);
      } catch (error) {
        if (!cancelled) setMessage(`تعذر تحميل عملاء الدفعات: ${error.message}`);
      }
    }
    loadPaymentCustomers();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, setMessage]);

  useEffect(() => {
    let cancelled = false;
    async function loadRelated() {
      const name = form.base_party_name.trim();
      if (!name) {
        setRelated({ projects: [], buildings: [] });
        return;
      }
      const query = new URLSearchParams({ role: 'customer', name });
      if (form.party_category && form.party_category !== 'unselected') query.set('category', form.party_category);
      if (form.project) query.set('project', form.project);
      try {
        const data = await api.request(`/api/party-related?${query.toString()}`);
        if (!cancelled) setRelated({ projects: data.projects || [], buildings: data.buildings || [] });
      } catch {
        if (!cancelled) setRelated({ projects: [], buildings: [] });
      }
    }
    loadRelated();
    return () => {
      cancelled = true;
    };
  }, [api, form.base_party_name, form.party_category, form.project]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateCustomer(value) {
    setEditingPayment(null);
    setForm((current) => ({ ...current, base_party_name: value, project: '', building_unit: '' }));
  }

  function resetPaymentForm({ keepCustomer = true } = {}) {
    setEditingPayment(null);
    setForm((current) => ({
      party_category: keepCustomer ? current.party_category : 'retail',
      base_party_name: keepCustomer ? current.base_party_name : '',
      project: keepCustomer ? current.project : '',
      building_unit: keepCustomer ? current.building_unit : '',
      amount: '',
      entry_date: new Date().toISOString().slice(0, 10),
      note: '',
    }));
  }

  function editPayment(row) {
    setEditingPayment(row);
    setReviewCustomer(row.base_party_name || row.customer_name || row.customer_display_name || row.party_display_name || '');
    setForm({
      party_category: row.party_category || 'retail',
      base_party_name: row.base_party_name || row.customer_name || row.customer_display_name || '',
      project: row.project || '',
      building_unit: row.building_unit || '',
      amount: Math.abs(Number(row.collection_amount || 0)) || '',
      entry_date: row.entry_date || new Date().toISOString().slice(0, 10),
      note: row.collection_note || row.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deletePayment(row) {
    if (!window.confirm(`حذف تحصيل ${row.document_operation_no || row.operation_no || row.id}؟`)) return;
    setBusy(true);
    try {
      await api.request(`/api/entries/${row.id}`, { method: 'DELETE' });
      setRecent((current) => current.filter((item) => item.id !== row.id));
      setMessage('تم حذف الدفعة.');
      await refreshAll();
    } catch (error) {
      setMessage(`تعذر حذف الدفعة: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function savePayment(event) {
    event.preventDefault();
    if (!canUser(currentUser, 'can_create_payments')) {
      setMessage('هذا المستخدم غير مسموح له بتسجيل الدفعات.');
      return;
    }
    if (!String(form.base_party_name || '').trim()) {
      setMessage('لا يمكن حفظ الدفعة قبل اختيار أو كتابة اسم العميل.');
      return;
    }
    setBusy(true);
    try {
      const paymentPayload = {
        ...(editingPayment || {}),
        ...form,
        party_role: 'customer',
        document_type: 'payment',
        document_status: 'approved',
        accounting_status: 'تحصيل',
        customer_name: form.base_party_name,
        base_party_name: form.base_party_name,
        collection_amount: form.amount,
        collection_note: form.note,
        unit_code: 'count',
        item_count: 0,
        total_quantity: 0,
        rate: 0,
        work_type: 'تحصيل',
        description: 'تحصيل',
        created_by: currentUser?.display_name,
        updated_by: currentUser?.display_name,
      };
      const saved = editingPayment
        ? await api.request(`/api/entries/${editingPayment.id}`, {
          method: 'PUT',
          body: JSON.stringify(paymentPayload),
        })
        : await api.request('/api/payments', {
          method: 'POST',
          body: JSON.stringify({
          ...form,
          customer_name: form.base_party_name,
          created_by: currentUser?.display_name,
          updated_by: currentUser?.display_name,
          }),
        });
      setRecent((current) => {
        const displaySaved = {
          ...saved,
          document_operation_no: saved.document_operation_no || editingPayment?.document_operation_no || editingPayment?.operation_no || saved.operation_no,
        };
        const next = current.filter((row) => row.id !== displaySaved.id);
        return [displaySaved, ...next].sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')) || Number(b.id || 0) - Number(a.id || 0));
      });
      setMessage(editingPayment ? 'تم تعديل الدفعة.' : 'تم حفظ الدفعة كحركة مستقلة.');
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
          <h2><WalletCards size={18} /> {editingPayment ? 'تعديل دفعة' : 'الدفعات'}</h2>
          {editingPayment && <span className="user-chip">تحصيل - {editingPayment.document_operation_no || editingPayment.operation_no || editingPayment.id}</span>}
        </div>
        <div className="form-grid">
          <Field label="التصنيف">
            <select value={form.party_category} onChange={(event) => update('party_category', event.target.value)}>
              <option value="unselected">بدون تصنيف</option>
              <option value="retail">فرد / مهندس</option>
              <option value="corporate">شركة</option>
            </select>
          </Field>
          <ComboField label="اسم العميل بدون م. أو شركة" value={form.base_party_name} options={customerNames} onChange={updateCustomer} />
          <ComboField label="المشروع" value={form.project} options={projectOptions} onChange={(value) => update('project', value)} />
          <ComboField label="المبنى / الوحدة" value={form.building_unit} options={buildingOptions} onChange={(value) => update('building_unit', value)} />
          <Field label="قيمة الدفعة">
            <input type="number" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} required />
          </Field>
          <Field label="التاريخ">
            <input type="date" value={form.entry_date} onChange={(event) => update('entry_date', event.target.value)} />
          </Field>
          <Field label="ملاحظة">
            <input value={form.note} onChange={(event) => update('note', event.target.value)} />
          </Field>
        </div>
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            <Save size={18} /> {editingPayment ? 'حفظ التعديل' : 'حفظ الدفعة'}
          </button>
          {editingPayment && (
            <button type="button" onClick={() => resetPaymentForm({ keepCustomer: true })} disabled={busy}>
              إلغاء التعديل
            </button>
          )}
        </div>
      </form>
      <section className="panel">
        <div className="panel-head">
          <h2>مراجعة دفعات عميل</h2>
        </div>
        <div className="history-filter-row">
          <ComboField label="اختيار العميل" value={reviewCustomer} options={paymentCustomerNames} onChange={setReviewCustomer} />
          <button type="button" onClick={() => setReviewCustomer('')}>كل الدفعات</button>
        </div>
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr><th>التاريخ</th><th>العميل</th><th>المشروع</th><th>الوحدة</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr>
            </thead>
            <tbody>
              {visiblePayments.map((row) => (
                <tr key={row.id} className={editingPayment?.id === row.id ? 'active-edit-row' : ''}>
                  <td>{text(row.entry_date)}</td>
                  <td>{text(row.customer_display_name || row.customer_name)}</td>
                  <td>{text(row.project)}</td>
                  <td>{text(row.building_unit)}</td>
                  <td>{money(Math.abs(Number(row.collection_amount || 0)))}</td>
                  <td>{text(row.collection_note)}</td>
                  <td className="row-actions">
                    <button type="button" className="icon-button" title="تعديل الدفعة" onClick={() => editPayment(row)}>
                      <Pencil size={16} />
                    </button>
                    <button type="button" className="icon-button danger" title="حذف الدفعة" onClick={() => deletePayment(row)}>
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
}) {
  const [nextDoc, setNextDoc] = useState(null);
  const meta = documentTypeMeta(entryForm.document_type);
  const partyOptions = entryForm.party_role === 'contractor' ? lookups.contractors : lookups.customers;
  const contextRows = editorContext?.reportData?.rows || [];
  const relatedProjects = uniqueValues([...contextRows.map((row) => row.project), ...lookupValues(lookups.projects)]);
  const relatedBuildings = uniqueValues(contextRows.map((row) => row.building_unit));
  const relatedWorkTypes = uniqueValues([...contextRows.map((row) => row.work_type), ...lookupValues(lookups.workTypes)]);

  useEffect(() => {
    let cancelled = false;
    async function loadNext() {
      if (editingId || entryForm.document_id) {
        setNextDoc(null);
        return;
      }
      try {
        const data = await api.request(`/api/next-document-no?type=${entryForm.document_type}`);
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
    });
  }

  function resetForm() {
    if (!window.confirm('سيتم مسح نموذج الإدخال الحالي فقط. هل تريد المتابعة؟')) return;
    setEntryForm(DEFAULT_ENTRY);
    setEditingId(null);
  }

  if (editorContext?.reportData) {
    return (
      <InlineDocumentEditor
        api={api}
        data={editorContext.reportData}
        document={editorContext.document}
        party={editorContext.party}
        onCloseContext={onCloseContext}
        onDeleteRow={onDeleteRow}
        setMessage={setMessage}
      />
    );
  }

  if (!editingId) {
    return (
      <SmartEntryEditor
        api={api}
        lookups={lookups}
        entryForm={entryForm}
        setEntryForm={setEntryForm}
        nextDoc={nextDoc}
        setEditingId={setEditingId}
        currentUser={currentUser}
        refreshAll={refreshAll}
        setMessage={setMessage}
        busy={busy}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="page-stack">
      <form className="panel entry-editor" onSubmit={saveEntry}>
      <div className="panel-head">
        <h2>{editingId ? 'تعديل بند' : 'بند جديد'}</h2>
        <div className="document-id">
          <span>ID</span>
          <strong>{entryForm.operation_no || entryForm.serial || nextDoc?.operation_no || 'Auto'}</strong>
        </div>
      </div>

      <div className="entry-layout">
        <section className="form-section fixed-data-section">
          <h3>بيانات ثابتة للمستند</h3>
          <div className="form-grid">
            <Field label="نوع المستند">
              <select value={entryForm.document_type} onChange={(event) => changeDocumentType(event.target.value)}>
                {DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="الطرف">
              <select value={entryForm.party_role} onChange={(event) => update('party_role', event.target.value)}>
                <option value="customer">عميل</option>
                <option value="contractor">مقاول</option>
              </select>
            </Field>
            <Field label="التصنيف">
              <select value={entryForm.party_category} onChange={(event) => update('party_category', event.target.value)}>
                <option value="unselected">بدون تصنيف</option>
                <option value="retail">فرد / مهندس</option>
                <option value="corporate">شركة</option>
              </select>
            </Field>
            <ComboField
              label="اسم الطرف بدون م. أو شركة"
              value={entryForm.base_party_name || ''}
              options={partyOptions.map((party) => party.base_name || party.display_name)}
              onChange={(value) => {
                const existing = partyOptions.find((party) => (party.base_name || party.display_name) === value);
                setEntryForm((current) => ({
                  ...current,
                  base_party_name: value,
                  customer_name: value,
                  party_id: existing?.id || current.party_id || '',
                  party_category: existing?.category || current.party_category,
                  customer_display_name: existing?.display_name || current.customer_display_name,
                }));
              }}
            />
            <ComboField label="المشروع" value={entryForm.project || ''} options={relatedProjects} onChange={(value) => update('project', value)} />
            <ComboField label="المبنى / الوحدة" value={entryForm.building_unit || ''} options={relatedBuildings} onChange={(value) => update('building_unit', value)} />
            <ComboField label="نوع الأعمال" value={entryForm.work_type || ''} options={relatedWorkTypes} onChange={(value) => update('work_type', value)} />
          </div>
        </section>

        <section className="form-section">
          <h3>توصيفات الأعمال</h3>
          <div className="form-grid two">
            <Field label="بيان">
              <textarea value={entryForm.description || ''} onChange={(event) => update('description', event.target.value)} />
            </Field>
            <Field label="توصيف إضافي/زجاج">
              <textarea value={entryForm.glass_spec || ''} onChange={(event) => update('glass_spec', event.target.value)} />
            </Field>
            <Field label="توصيف إضافي/القطاع">
              <textarea value={entryForm.profile_spec || ''} onChange={(event) => update('profile_spec', event.target.value)} />
            </Field>
            <Field label="اللون">
              <textarea value={entryForm.color || ''} onChange={(event) => update('color', event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="form-section">
          <h3>الكميات والحساب</h3>
          <div className="form-grid">
            <Field label="الوحدة">
              <select value={entryForm.unit_code} onChange={(event) => update('unit_code', event.target.value)}>
                {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
              </select>
            </Field>
            <Field label="طريقة القياس">
              <select value={entryForm.measurement_mode} onChange={(event) => update('measurement_mode', event.target.value)}>
                <option value="standard">قياسي</option>
                <option value="engineering">هندسي</option>
              </select>
            </Field>
            <Field label="العدد">
              <input type="number" step="0.01" value={entryForm.item_count || ''} onChange={(event) => update('item_count', event.target.value)} />
            </Field>
            <Field label="العرض سم">
              <input type="number" step="0.01" value={entryForm.width_cm || ''} onChange={(event) => update('width_cm', event.target.value)} />
            </Field>
            <Field label="الارتفاع سم">
              <input type="number" step="0.01" value={entryForm.height_cm || ''} onChange={(event) => update('height_cm', event.target.value)} />
            </Field>
            <Field label="كمية مباشرة">
              <input type="number" step="0.01" value={entryForm.total_quantity || ''} onChange={(event) => update('total_quantity', event.target.value)} />
            </Field>
            <Field label="الفئة">
              <input type="number" step="0.01" value={entryForm.rate || ''} onChange={(event) => update('rate', event.target.value)} />
            </Field>
            <Field label="سعر ثابت للوحدة">
              <input type="number" step="0.01" value={entryForm.building_unit_price || ''} onChange={(event) => update('building_unit_price', event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="form-section">
          <h3>الضرائب والتأمينات</h3>
          <div className="tax-grid">
            {TAXES.map((tax) => (
              <label key={tax.key} className="check-tile">
                <input type="checkbox" checked={!!entryForm[tax.key]} onChange={(event) => update(tax.key, event.target.checked)} />
                <span>{tax.label}</span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <datalist id="partyNames">
        {partyOptions.map((party) => <option key={party.id || party.display_name} value={party.base_name || party.display_name} />)}
      </datalist>
      <datalist id="projects">
        {(lookups.projects || []).map((item) => <option key={item.value} value={item.value} />)}
      </datalist>
      <datalist id="workTypes">
        {(lookups.workTypes || []).map((item) => <option key={item.value} value={item.value} />)}
      </datalist>

      <div className="form-actions">
        <button className="primary" disabled={busy}>
          <Save size={18} /> حفظ
        </button>
        <button type="button" title="مسح نموذج الإدخال الحالي بعد تأكيد" onClick={resetForm}>
          <Plus size={18} /> مسح النموذج
        </button>
        <span>{meta.label} / {statusLabel(entryForm.document_status)}</span>
      </div>
      </form>
      {editorContext?.reportData && (
        <section className="panel linked-report">
          <div className="panel-head">
            <h2>التقرير المفتوح أثناء التعديل</h2>
            <button type="button" onClick={onCloseContext}>إغلاق التقرير</button>
          </div>
          <DocumentPreview
            data={editorContext.reportData}
            onEditRow={(row) => onEditRow(row, editorContext)}
            onDeleteRow={onDeleteRow}
          />
        </section>
      )}
    </div>
  );
}

const SMART_ROW_TEMPLATE = {
  building_unit: '',
  floor_apartment: '',
  description: '',
  glass_spec: '',
  profile_spec: '',
  color: '',
  unit_code: 'sqm',
  measurement_mode: 'standard',
  item_count: '',
  width_cm: '',
  height_cm: '',
  total_quantity: '',
  rate: '',
  building_unit_price: '',
};

function smartRowFrom(previous = {}) {
  return {
    ...SMART_ROW_TEMPLATE,
    unit_code: previous.unit_code || 'sqm',
    measurement_mode: previous.measurement_mode || 'standard',
    _touched: {},
  };
}

function rowHasData(row) {
  const touched = row._touched || {};
  return [
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
    row.rate && (row.description || row.width_cm || row.height_cm || row.total_quantity),
    row.building_unit_price,
  ].some((value) => String(value || '').trim());
}

function rowUnitLabel(unitCode) {
  return UNITS.find((unit) => unit.value === unitCode)?.label || 'م²';
}

function num(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function canUser(user, permission) {
  return user?.role === 'admin' || !!user?.[permission];
}

function calculateDraftRow(row, fixed) {
  const unitCode = row.unit_code || fixed.unit_code || 'sqm';
  const mode = row.measurement_mode || fixed.measurement_mode || 'standard';
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
  } else if (unitCode === 'lm') {
    quantity = roundMoney((width / 100) * (count || 1));
  } else if (unitCode === 'count') {
    quantity = direct || count || 1;
  } else {
    const itemArea = (width / 100) * (height / 100);
    area = itemArea * (count || 1);
    quantity = mode === 'engineering' ? roundMoney(area) : (itemArea < 1 ? (count || 1) : roundMoney(area));
  }
  if (!area && width && height) area = roundMoney((width / 100) * (height / 100) * (count || 1));
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
  return {
    ...row,
    unit_code: unitCode,
    measurement_mode: mode,
    unit: rowUnitLabel(unitCode),
    quantity: roundMoney(quantity),
    area_m2: roundMoney(area),
    gross_total: roundMoney(gross),
    net_total: roundMoney(net),
    vat_amount: roundMoney(vat),
    social_insurance_amount: roundMoney(social),
    stamp_amount: roundMoney(stamp),
    works_insurance_amount: roundMoney(works),
    final_insurance_amount: roundMoney(finalInsurance),
    contractor_tax_amount: roundMoney(contractorTax),
    statement_text: [row.description, row.glass_spec, row.profile_spec, row.color].filter(Boolean).join('\n'),
  };
}

function SmartEntryEditor({ api, lookups, entryForm, setEntryForm, nextDoc, setEditingId, currentUser, refreshAll, setMessage, busy, onBack }) {
  const [rows, setRows] = useState([smartRowFrom(entryForm)]);
  const [historyRows, setHistoryRows] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeCell, setActiveCell] = useState('');
  const [tableExpanded, setTableExpanded] = useState(false);
  const meta = documentTypeMeta(entryForm.document_type);
  const partyOptions = entryForm.party_role === 'contractor' ? lookups.contractors : lookups.customers;
  const filteredParties = (partyOptions || []).filter((party) => (
    entryForm.party_category === 'unselected' || !entryForm.party_category || party.category === entryForm.party_category
  ));
  const rowData = rows.filter(rowHasData).map(({ _touched, ...row }) => row);
  const scopedHistoryRows = historyRows.filter((row) => (
    (!entryForm.project || row.project === entryForm.project)
    && (!entryForm.work_type || row.work_type === entryForm.work_type)
  ));
  const suggestionRows = scopedHistoryRows.length ? scopedHistoryRows : historyRows;
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
  const rateOptions = uniqueValues([
    ...rows.map((row) => row.rate),
    ...suggestionRows.map((row) => row.rate),
    ...lookupValues(lookups.rates),
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      const name = String(entryForm.base_party_name || '').trim();
      if (!name) {
        setHistoryRows([]);
        return;
      }
      try {
        const query = new URLSearchParams({ customer: name, limit: '500' });
        const data = await api.request(`/api/entries?${query.toString()}`);
        if (!cancelled) setHistoryRows(data.rows || []);
      } catch {
        if (!cancelled) setHistoryRows([]);
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [api, entryForm.base_party_name]);

  useEffect(() => {
    if (!tableExpanded) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setTableExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tableExpanded]);

  function updateFixed(patch) {
    setPreviewData(null);
    setEntryForm((current) => ({ ...current, ...patch }));
  }

  function changeDocumentType(value) {
    const nextMeta = documentTypeMeta(value);
    updateFixed({
      document_type: value,
      document_status: nextMeta.status,
      party_role: nextMeta.role,
    });
  }

  function defaultsForDescription(value, currentRows, currentIndex) {
    const needle = normalizeArabic(value);
    if (!needle) return null;
    const previousRows = currentRows.slice(0, currentIndex).reverse();
    const candidates = [...previousRows, ...suggestionRows];
    return candidates.find((row) => normalizeArabic(row.description) === needle)
      || candidates.find((row) => normalizeArabic(row.description).includes(needle));
  }

  function updateRow(index, key, value) {
    setPreviewData(null);
    setRows((current) => {
      const copyKeys = ['building_unit', 'floor_apartment', 'glass_spec', 'profile_spec', 'color', 'rate', 'unit_code', 'measurement_mode'];
      const next = current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const patch = {
          [key]: value,
          _touched: { ...(row._touched || {}), [key]: true },
        };
        if (key === 'description') {
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
        next.push(smartRowFrom(next[index]));
      }
      return next;
    });
  }

  function focusCell(rowIndex, colKey) {
    window.setTimeout(() => {
      document.querySelector(`[data-smart-cell="${rowIndex}:${colKey}"]`)?.focus();
    }, 0);
  }

  function handleCellKeyDown(event, index, key) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const nextIndex = index + 1;
    if (nextIndex >= rows.length && rowHasData(rows[index])) {
      setRows((current) => [...current, smartRowFrom(current[current.length - 1])]);
    }
    focusCell(nextIndex, key);
  }

  function validateMain() {
    if (entryForm.document_type === 'invoice' && !canUser(currentUser, 'can_create_invoices')) {
      return 'هذا المستخدم غير مسموح له بإنشاء فواتير معتمدة.';
    }
    if (String(entryForm.document_status || '') !== String(meta.status || '') && !canUser(currentUser, 'can_change_status')) {
      return 'هذا المستخدم غير مسموح له بتغيير حالة المستند.';
    }
    const missing = [];
    if (!entryForm.document_type) missing.push('نوع المستند');
    if (!entryForm.party_category) missing.push('تصنيف العميل');
    if (!String(entryForm.base_party_name || '').trim()) missing.push('اسم العميل/المقاول');
    if (!String(entryForm.project || '').trim()) missing.push('المشروع');
    if (!String(entryForm.work_type || '').trim()) missing.push('نوع الأعمال');
    if (!String(entryForm.entry_date || '').trim()) missing.push('التاريخ');
    if (missing.length) return `لا يمكن الحفظ قبل استكمال البيانات الرئيسية: ${missing.join('، ')}`;
    return '';
  }

  function buildPreview() {
    const validation = validateMain();
    if (validation) {
      setMessage(validation);
      return null;
    }
    if (!rowData.length) {
      setMessage('لا يمكن الحفظ أو المعاينة بدون إدخال بند واحد على الأقل في الجدول.');
      return null;
    }
    const calculatedRows = rowData.map((row, index) => calculateDraftRow({
      ...row,
      id: `draft-${index + 1}`,
      building_unit: row.building_unit || entryForm.building_unit,
      floor_apartment: row.floor_apartment || entryForm.floor_apartment,
      entry_date: entryForm.entry_date,
      work_type: entryForm.work_type,
    }, entryForm));
    const totals = calculatedRows.reduce((acc, row) => {
      acc.quantity += num(row.quantity);
      acc.gross_total += num(row.gross_total);
      acc.net_total += num(row.net_total);
      return acc;
    }, { quantity: 0, gross_total: 0, net_total: 0, debit: 0, credit: 0 });
    const discountValue = num(entryForm.discount_value);
    let discountAmount = 0;
    if (entryForm.discount_type === 'rate') discountAmount = totals.net_total * (discountValue / 100);
    if (entryForm.discount_type === 'amount') discountAmount = discountValue;
    totals.discount_amount = roundMoney(discountAmount);
    totals.net_total = roundMoney(totals.net_total - discountAmount);
    return {
      title: documentTypeLabel(entryForm.document_type),
      type: entryForm.document_type === 'invoice' ? 'invoice' : entryForm.document_type === 'contractor_certificate' ? 'contractor' : 'offer',
      operation_no: entryForm.operation_no || nextDoc?.operation_no || 'Auto',
      serial: entryForm.serial || nextDoc?.next_no || '',
      party: entryForm.party_category === 'corporate' ? `شركة ${entryForm.base_party_name}` : entryForm.party_category === 'unselected' ? entryForm.base_party_name : `م. ${entryForm.base_party_name}`,
      project: entryForm.project,
      building_unit: [entryForm.building_unit, entryForm.floor_apartment].filter(Boolean).join(' / '),
      overall_work_type: entryForm.work_type,
      entry_date: entryForm.entry_date,
      generated_at: new Date().toISOString(),
      totals,
      tax_breakdown: TAXES.map((tax) => ({
        key: tax.key,
        label: tax.label,
        amount: calculatedRows.reduce((sum, row) => sum + num(row[tax.amountKey || tax.key.replace('_enabled', '_amount')]), 0),
      })).filter((tax) => tax.amount),
      discount_label: entryForm.discount_type === 'rate' && discountValue ? `خصم خاص ${money(discountValue)}%` : entryForm.discount_type === 'amount' && discountValue ? `خصم خاص ${money(discountValue)} جنيه` : '',
      rows: calculatedRows,
      statementRows: [],
      summaryRows: [],
    };
  }

  function previewDraft() {
    const preview = buildPreview();
    if (preview) {
      setPreviewData(preview);
      setMessage('تم تجهيز معاينة الإدخال. راجع البنود ثم اضغط اعتماد وحفظ.');
    }
  }

  async function submitDraft() {
    const preview = previewData || buildPreview();
    if (!preview) return;
    if (!window.confirm(`سيتم حفظ ${rowData.length} بند تحت رقم ${entryForm.operation_no || nextDoc?.operation_no || 'تلقائي'}. بعد الحفظ سيكون رقم المستند ثابتاً. هل تريد المتابعة؟`)) return;
    setSaving(true);
    try {
      let documentId = entryForm.document_id || '';
      let operationNo = entryForm.operation_no || nextDoc?.operation_no || '';
      let serial = entryForm.serial || nextDoc?.next_no || '';
      for (const row of rowData) {
        const saved = await api.request('/api/entries', {
          method: 'POST',
          body: JSON.stringify({
            ...entryForm,
            ...row,
            document_id: documentId,
            serial,
            operation_no: operationNo,
            customer_name: entryForm.base_party_name,
            customer_display_name: '',
            building_unit: row.building_unit || entryForm.building_unit,
            floor_apartment: row.floor_apartment || entryForm.floor_apartment,
            created_by: currentUser?.display_name,
            updated_by: currentUser?.display_name,
          }),
        });
        if (!saved || !saved.id) throw new Error('Server saved no row. Please retry after refresh.');
        documentId = saved.document_id || documentId;
        operationNo = saved.operation_no || operationNo;
        serial = saved.serial || serial;
      }
      if (documentId) {
        await api.request(`/api/documents/${documentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            status: entryForm.document_status,
            project: entryForm.project,
            building_unit: [entryForm.building_unit, entryForm.floor_apartment].filter(Boolean).join(' / '),
            discount_type: entryForm.discount_type || 'none',
            discount_value: num(entryForm.discount_value),
          }),
        });
      }
      setMessage(`تم حفظ المستند ${operationNo || ''} بعدد ${rowData.length} بند.`);
      setEntryForm(DEFAULT_ENTRY);
      setRows([smartRowFrom(DEFAULT_ENTRY)]);
      setPreviewData(null);
      setEditingId(null);
      await refreshAll?.();
    } catch (error) {
      setMessage(`تعذر حفظ المستند: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function optionsForCell(key) {
    return {
      building_unit: buildingOptions,
      floor_apartment: unitOptions,
      description: descriptionOptions,
      glass_spec: glassOptions,
      profile_spec: profileOptions,
      color: colorOptions,
      rate: rateOptions,
    }[key] || [];
  }

  function deleteSmartRow(index) {
    setPreviewData(null);
    setRows((current) => {
      if (current.length <= 1) return [smartRowFrom(entryForm)];
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.some((row) => !rowHasData(row)) ? next : [...next, smartRowFrom(next[next.length - 1] || entryForm)];
    });
  }

  const rowInput = (index, key, extra = {}) => {
    const { list: _unusedList, ...inputProps } = extra;
    const value = rows[index][key] || '';
    const options = optionsForCell(key);
    const typed = normalizeArabic(value);
    const shownOptions = options
      .filter((option) => !typed || normalizeArabic(option).includes(typed))
      .slice(0, 8);
    const cellKey = `${index}:${key}`;
    const showSuggestions = activeCell === cellKey && shownOptions.length > 0;
    return (
      <div
        className="cell-combo"
        onMouseDownCapture={() => setActiveCell(cellKey)}
        onFocusCapture={() => setActiveCell(cellKey)}
      >
        <input
          {...inputProps}
          data-smart-cell={cellKey}
          value={value}
          onFocus={() => setActiveCell(cellKey)}
          onBlur={() => {}}
          onChange={(event) => updateRow(index, key, event.target.value)}
          onKeyDown={(event) => handleCellKeyDown(event, index, key)}
          autoComplete="off"
          dir={extra.dir || 'auto'}
        />
        {showSuggestions && (
          <div className="cell-suggestions" onMouseDown={(event) => event.preventDefault()}>
            {shownOptions.map((option) => (
              <button key={option} type="button" onMouseDown={(event) => {
                event.preventDefault();
                updateRow(index, key, option);
                setActiveCell('');
              }}>
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const rowSelect = (index, key, children) => (
    <select
      data-smart-cell={`${index}:${key}`}
      value={rows[index][key] || ''}
      onChange={(event) => updateRow(index, key, event.target.value)}
      onKeyDown={(event) => handleCellKeyDown(event, index, key)}
    >
      {children}
    </select>
  );

  return (
    <div className="page-stack">
      <form className="panel entry-editor smart-entry" onSubmit={(event) => event.preventDefault()}>
        <div className="panel-head">
          <h2>إدخال مستند جديد</h2>
          {onBack && (
            <button type="button" onClick={onBack} title="إغلاق والرجوع">
              <X size={17} /> إغلاق
            </button>
          )}
          <div className="document-id">
            <span>ID</span>
            <strong>{entryForm.operation_no || nextDoc?.operation_no || 'Auto'}</strong>
          </div>
        </div>

        <section className="form-section fixed-data-section">
          <h3>بيانات ثابتة للمستند</h3>
          <div className="form-grid smart-fixed-grid">
            <Field label="نوع المستند">
              <select value={entryForm.document_type} onChange={(event) => changeDocumentType(event.target.value)}>
                {DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="الطرف">
              <select value={entryForm.party_role} onChange={(event) => updateFixed({ party_role: event.target.value })}>
                <option value="customer">عميل</option>
                <option value="contractor">مقاول</option>
              </select>
            </Field>
            <Field label="تصنيف العميل">
              <select value={entryForm.party_category} onChange={(event) => updateFixed({ party_category: event.target.value })}>
                <option value="unselected">بدون تصنيف</option>
                <option value="retail">فرد / مهندس</option>
                <option value="corporate">شركة</option>
              </select>
            </Field>
            <ComboField
              label="اسم العميل/المقاول بدون م. أو شركة"
              value={entryForm.base_party_name || ''}
              options={filteredParties.map((party) => party.base_name || party.display_name)}
              onChange={(value) => {
                const existing = filteredParties.find((party) => (party.base_name || party.display_name) === value);
                updateFixed({
                  base_party_name: value,
                  customer_name: value,
                  party_id: existing?.id || '',
                  party_category: existing?.category || entryForm.party_category,
                  customer_display_name: existing?.display_name || '',
                });
              }}
            />
            <ComboField label="المشروع" value={entryForm.project || ''} options={projectOptions} onChange={(value) => updateFixed({ project: value })} />
            <ComboField label="نوع الأعمال" value={entryForm.work_type || ''} options={workTypeOptions} onChange={(value) => updateFixed({ work_type: value })} />
            <Field label="التاريخ">
              <input type="date" value={entryForm.entry_date || ''} onChange={(event) => updateFixed({ entry_date: event.target.value })} />
            </Field>
            <Field label="الحالة">
              <select value={entryForm.document_status || meta.status} disabled={!canUser(currentUser, 'can_change_status')} onChange={(event) => updateFixed({ document_status: event.target.value })}>
                <option value="draft">مسودة</option>
                <option value="approved">معتمد</option>
                <option value="closed">مغلق</option>
              </select>
            </Field>
            <Field label="نوع الخصم">
              <select value={entryForm.discount_type || 'none'} onChange={(event) => updateFixed({ discount_type: event.target.value })}>
                <option value="none">بدون</option>
                <option value="rate">نسبة</option>
                <option value="amount">مبلغ</option>
              </select>
            </Field>
            <Field label="قيمة الخصم">
              <input type="number" step="0.01" value={entryForm.discount_value || ''} onChange={(event) => updateFixed({ discount_value: event.target.value })} />
            </Field>
          </div>
        </section>

        <section className="form-section compact-tax-section">
          <h3>الضرائب والتأمينات</h3>
          <div className="tax-grid compact-tax-grid">
            {TAXES.map((tax) => (
              <label key={tax.key} className="check-tile" title={tax.label}>
                <input type="checkbox" checked={!!entryForm[tax.key]} onChange={(event) => updateFixed({ [tax.key]: event.target.checked })} />
                <span>{tax.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className={`form-section smart-table-section${tableExpanded ? ' expanded' : ''}`}>
          <div className="section-title-row">
            <h3>بنود المستند</h3>
            <div className="section-title-actions">
              <ItemReadyBadge count={rowData.length} />
              <button
                type="button"
                className="icon-button expand-table-button"
                title={tableExpanded ? 'تصغير جدول البنود' : 'توسيع جدول البنود لملء الشاشة'}
                onClick={() => setTableExpanded((current) => !current)}
              >
                {tableExpanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            </div>
          </div>
          <div className="table-scroll smart-table-scroll">
            <table className="smart-entry-table">
              <thead>
                <tr>
                  <th>مبنى</th>
                  <th>وحدة</th>
                  <th>بيان</th>
                  <th>زجاج</th>
                  <th>قطاع</th>
                  <th>لون</th>
                  <th>عدد</th>
                  <th>عرض سم</th>
                  <th>ارتفاع سم</th>
                  <th>الوحدة</th>
                  <th>كمية مباشرة</th>
                  <th>فئة</th>
                  <th>ثابت</th>
                  <th>قياس</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className={rowHasData(row) ? '' : 'ghost-row'}>
                    <td>{rowInput(index, 'building_unit', { list: 'smartBuildings' })}</td>
                    <td>{rowInput(index, 'floor_apartment', { list: 'smartUnits' })}</td>
                    <td>{rowInput(index, 'description', { list: 'smartDescriptions' })}</td>
                    <td>{rowInput(index, 'glass_spec', { list: 'smartGlass' })}</td>
                    <td>{rowInput(index, 'profile_spec', { list: 'smartProfiles' })}</td>
                    <td>{rowInput(index, 'color', { list: 'smartColors' })}</td>
                    <td>{rowInput(index, 'item_count', { type: 'number', step: '0.01', dir: 'ltr' })}</td>
                    <td>{rowInput(index, 'width_cm', { type: 'number', step: '0.01', dir: 'ltr' })}</td>
                    <td>{rowInput(index, 'height_cm', { type: 'number', step: '0.01', dir: 'ltr' })}</td>
                    <td>{rowSelect(index, 'unit_code', UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>))}</td>
                    <td>{rowInput(index, 'total_quantity', { type: 'number', step: '0.01', dir: 'ltr' })}</td>
                    <td>{rowInput(index, 'rate', { type: 'number', step: '0.01', dir: 'ltr', list: 'smartRates' })}</td>
                    <td>{rowInput(index, 'building_unit_price', { type: 'number', step: '0.01', dir: 'ltr' })}</td>
                    <td>{rowSelect(index, 'measurement_mode', <><option value="standard">قياسي</option><option value="engineering">هندسي</option></>)}</td>
                    <td>
                      <button type="button" className="icon-button danger" title="حذف هذا البند" onClick={() => deleteSmartRow(index)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="smartBuildings">{buildingOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="smartUnits">{unitOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="smartDescriptions">{descriptionOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="smartGlass">{glassOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="smartProfiles">{profileOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="smartColors">{colorOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="smartRates">{rateOptions.map((item) => <option key={item} value={item} />)}</datalist>
        </section>

        <div className="form-actions sticky-actions">
          <button type="button" className="primary" onClick={previewDraft} disabled={busy || saving}>
            <Eye size={18} /> حفظ ومعاينة
          </button>
          <button type="button" onClick={submitDraft} disabled={busy || saving || !previewData}>
            <Save size={18} /> اعتماد وحفظ
          </button>
          <button type="button" onClick={() => {
            if (!window.confirm('مسح نموذج الإدخال الحالي؟')) return;
            setEntryForm(DEFAULT_ENTRY);
            setRows([smartRowFrom(DEFAULT_ENTRY)]);
            setPreviewData(null);
          }}>
            <Plus size={18} /> مسح النموذج
          </button>
          <ItemReadyBadge count={rowData.length} suffix="بند جاهز للحفظ" />
        </div>
      </form>

      {previewData && (
        <section className="panel linked-report">
          <div className="panel-head">
            <h2>معاينة قبل الحفظ</h2>
            <button type="button" onClick={() => setPreviewData(null)}>العودة للتعديل</button>
          </div>
          <DocumentPreview data={previewData} readOnly />
        </section>
      )}
    </div>
  );
}

function InlineDocumentEditor({ api, data, document, party, onCloseContext, onDeleteRow, setMessage }) {
  const [rows, setRows] = useState(data.rows || []);
  const initialTaxFlags = TAXES.reduce((flags, tax) => {
    flags[tax.key] = (data.rows || []).some((row) => !!row[tax.key]);
    return flags;
  }, {});
  const [main, setMain] = useState({
    operation_no: data.operation_no || '',
    party: data.party || party?.display_name || '',
    project: data.project || document?.project || '',
    building_unit: data.building_unit || document?.building_unit || '',
    work_type: data.overall_work_type || '',
    entry_date: rows[0]?.entry_date || new Date().toISOString().slice(0, 10),
    status: document?.status || rows[0]?.document_status || 'draft',
    discount_type: document?.discount_type || rows[0]?.discount_type || 'none',
    discount_value: document?.discount_value ?? rows[0]?.discount_value ?? '',
    ...initialTaxFlags,
  });
  const [saving, setSaving] = useState(false);

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function saveMain() {
    setSaving(true);
    try {
      const taxPatch = TAXES.reduce((patch, tax) => {
        patch[tax.key] = main[tax.key] ? 1 : 0;
        return patch;
      }, {});
      const documentPatch = {
        project: main.project,
        building_unit: main.building_unit,
        status: main.status,
        discount_type: main.discount_type || 'none',
        discount_value: Number(main.discount_value || 0),
      };
      if (document?.id) {
        await api.request(`/api/documents/${document.id}`, {
          method: 'PUT',
          body: JSON.stringify(documentPatch),
        });
      }
      const savedRows = await Promise.all(rows.map((row) => api.request(`/api/entries/${row.id}`, {
        method: 'PUT',
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
      })));
      setRows(savedRows);
      setMessage('تم حفظ بيانات المستند الرئيسية.');
    } catch (error) {
      setMessage(`تعذر حفظ بيانات المستند: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(row) {
    setSaving(true);
    try {
      const saved = await api.request(`/api/entries/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify(row),
      });
      updateRow(row.id, saved);
      setMessage('تم حفظ البند.');
    } catch (error) {
      setMessage(`تعذر حفظ البند: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteInlineRow(row) {
    await onDeleteRow(row.id);
    setRows((current) => current.filter((item) => item.id !== row.id));
  }

  return (
    <div className="page-stack">
      <section className="panel inline-document-editor">
        <div className="panel-head">
          <h2>تعديل المستند</h2>
          <button type="button" onClick={onCloseContext}>إغلاق التقرير</button>
        </div>
        <div className="form-grid">
          <Field label="ID">
            <input value={main.operation_no} readOnly />
          </Field>
          <Field label="العميل">
            <input value={main.party} onChange={(event) => setMain({ ...main, party: event.target.value })} />
          </Field>
          <Field label="التاريخ">
            <input type="date" value={main.entry_date} onChange={(event) => setMain({ ...main, entry_date: event.target.value })} />
          </Field>
          <Field label="المشروع">
            <input value={main.project} onChange={(event) => setMain({ ...main, project: event.target.value })} />
          </Field>
          <Field label="المبنى / الوحدة الافتراضية">
            <input value={main.building_unit} onChange={(event) => setMain({ ...main, building_unit: event.target.value })} />
          </Field>
          <Field label="نوع الأعمال">
            <input value={main.work_type} onChange={(event) => setMain({ ...main, work_type: event.target.value })} />
          </Field>
          <Field label="الحالة">
            <select value={main.status} onChange={(event) => setMain({ ...main, status: event.target.value })}>
              <option value="draft">مسودة</option>
              <option value="approved">معتمد</option>
              <option value="closed">مغلق</option>
            </select>
          </Field>
          <Field label="نوع الخصم">
            <select value={main.discount_type || 'none'} onChange={(event) => setMain({ ...main, discount_type: event.target.value })}>
              <option value="none">بدون</option>
              <option value="rate">نسبة</option>
              <option value="amount">مبلغ</option>
            </select>
          </Field>
          <Field label="قيمة الخصم">
            <input type="number" step="0.01" value={main.discount_value || ''} onChange={(event) => setMain({ ...main, discount_value: event.target.value })} />
          </Field>
        </div>
        <div className="tax-grid compact-tax-grid inline-tax-grid">
          {TAXES.map((tax) => (
            <label key={tax.key} className="check-tile" title={tax.label}>
              <input
                type="checkbox"
                checked={!!main[tax.key]}
                onChange={(event) => setMain({ ...main, [tax.key]: event.target.checked })}
              />
              <span>{tax.label}</span>
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button className="primary" type="button" onClick={saveMain} disabled={saving}>
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
                <th>الإجمالي</th>
                <th>الصافي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><input dir="auto" value={row.building_unit || ''} onChange={(event) => updateRow(row.id, { building_unit: event.target.value })} /></td>
                  <td><textarea dir="auto" value={row.description || ''} onChange={(event) => updateRow(row.id, { description: event.target.value })} /></td>
                  <td><textarea dir="auto" value={row.glass_spec || ''} onChange={(event) => updateRow(row.id, { glass_spec: event.target.value })} /></td>
                  <td><textarea dir="auto" value={row.profile_spec || ''} onChange={(event) => updateRow(row.id, { profile_spec: event.target.value })} /></td>
                  <td><textarea dir="auto" value={row.color || ''} onChange={(event) => updateRow(row.id, { color: event.target.value })} /></td>
                  <td><input type="number" step="0.01" value={row.item_count || ''} onChange={(event) => updateRow(row.id, { item_count: event.target.value })} /></td>
                  <td><input type="number" step="0.01" value={row.width_cm || ''} onChange={(event) => updateRow(row.id, { width_cm: event.target.value })} /></td>
                  <td><input type="number" step="0.01" value={row.height_cm || ''} onChange={(event) => updateRow(row.id, { height_cm: event.target.value })} /></td>
                  <td><input type="number" step="0.01" value={row.total_quantity || ''} onChange={(event) => updateRow(row.id, { total_quantity: event.target.value })} /></td>
                  <td><input type="number" step="0.01" value={row.rate || ''} onChange={(event) => updateRow(row.id, { rate: event.target.value })} /></td>
                  <td>{money(row.gross_total)}</td>
                  <td>{money(row.net_total)}</td>
                  <td className="row-actions">
                    <button className="icon-button" title="حفظ" onClick={() => saveRow(row)} disabled={saving}><Save size={16} /></button>
                    <button className="icon-button danger" title="حذف" onClick={() => deleteInlineRow(row)} disabled={saving}><Trash2 size={16} /></button>
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

function DocumentPreview({ data, onEditRow, onDeleteRow, compact = false, dimensionUnit = 'cm', readOnly = false }) {
  if (!data) {
    return <div className="empty-state"> </div>;
  }
  const rows = data.rows || [];
  const statementRows = data.statementRows || [];
  const paymentRows = data.paymentRows || [];
  const showDimensions = (data.show_dimensions || reportHasDimensions(rows)) && !statementRows.length;
  return (
    <div className="document-preview">
      <div className="doc-head">
        <div>
          <img src={hgadLogo} alt="HGAD" />
          <h2>{data.title}</h2>
          <p>{text(data.party)} / {text(data.project)}</p>
        </div>
        <div className="doc-meta">
          <strong>{text(data.operation_no || data.serial)}</strong>
          <span>{new Date(data.generated_at).toLocaleDateString('en-GB')}</span>
        </div>
      </div>

      <div className="totals">
        {statementRows.length && data.totals?.quantity ? <span>الكمية <strong>{money(data.totals.quantity)}</strong></span> : null}
        <span>الإجمالي <strong>{money(data.totals?.gross_total || data.totals?.debit)}</strong></span>
        {statementRows.length || paymentRows.length ? (
          <>
            {(data.tax_breakdown || []).map((tax) => <span key={tax.key || tax.label}>{tax.label} <strong>{money(tax.amount)}</strong></span>)}
            {data.discount_label && <span>{data.discount_label} <strong>{money(data.totals?.discount_amount)}</strong></span>}
            <span>دفعات/تحصيل <strong>{money(data.totals?.credit)}</strong></span>
          </>
        ) : (
          (data.tax_breakdown || []).map((tax) => <span key={tax.key || tax.label}>{tax.label} <strong>{money(tax.amount)}</strong></span>)
        )}
        {!statementRows.length && !paymentRows.length && data.discount_label && <span>{data.discount_label} <strong>{money(data.totals?.discount_amount)}</strong></span>}
        <span>الصافي <strong>{money(data.totals?.net_total)}</strong></span>
      </div>

      {data.summaryRows?.length > 0 && <SummaryTable rows={data.summaryRows} />}
      {statementRows.length > 0 && (
        <div className={compact ? 'table-scroll report-table compact-table' : 'table-scroll report-table'}>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستند</th>
                <th>المشروع</th>
                <th>التفاصيل</th>
                <th>الكمية</th>
                <th>ضرائب / خصم</th>
                <th>إجمالي المستند</th>
                <th>دفعات/تحصيل</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {statementRows.map((row, index) => (
                <tr key={`${row.document_id || row.operation_no || index}-${row.is_payment ? 'payment' : 'debit'}-${index}`} className={row.is_payment ? 'payment-row' : ''}>
                  <td>{text(row.entry_date)}</td>
                  <td className="statement-doc">{text(row.description)}</td>
                  <td>{text(row.project_label || [row.project, row.building_unit].filter(Boolean).join(' - '))}</td>
                  <td>{text(row.details)}</td>
                  <td>{row.is_payment ? '-' : money(row.quantity)}</td>
                  <td>{row.is_payment ? '-' : text([row.vat_amount ? `ضريبة ${money(row.vat_amount)}` : '', row.discount_amount ? `خصم ${money(row.discount_amount)}` : ''].filter(Boolean).join(' / ') || '-')}</td>
                  <td>{money(row.debit)}</td>
                  <td>{money(row.credit)}</td>
                  <td>{money(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paymentRows.length > 0 && (
        <div className={compact ? 'table-scroll report-table compact-table' : 'table-scroll report-table'}>
          <table>
            <thead>
              <tr>
                <th>تاريخ الدفعة</th>
                <th>بيان الدفعة</th>
                <th>ملاحظة</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((row, index) => (
                <tr key={`${row.id || index}-payment`} className="payment-row">
                  <td>{text(row.entry_date)}</td>
                  <td>{text(row.work_type || row.description || 'تحصيل')}</td>
                  <td>{text(row.collection_note || row.notes)}</td>
                  <td>{money(Math.abs(Number(row.collection_amount || 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!statementRows.length && rows.length > 0 ? (
        <div className={compact ? 'table-scroll report-table compact-table' : 'table-scroll report-table'}>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الأعمال</th>
                <th>البيان</th>
                {showDimensions && <th>المقاس</th>}
                <th>الوحدة</th>
                <th>العدد</th>
                <th>الكمية</th>
                <th>الفئة</th>
                <th>الإجمالي</th>
                <th>الصافي</th>
                {!readOnly && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{text(row.entry_date)}</td>
                  <td>{text(row.work_type)}</td>
                  <td className="desc-cell">{statementOf(row)}</td>
                  {showDimensions && <td>{rowDimension(row, dimensionUnit) || '-'}</td>}
                  <td>{text(row.unit_code ? rowUnitLabel(row.unit_code) : row.unit)}</td>
                  <td>{Number(row.item_count || 0) ? money(row.item_count) : '-'}</td>
                  <td>{money(row.quantity)}</td>
                  <td>{money(row.rate)}</td>
                  <td>{money(row.gross_total)}</td>
                  <td>{money(row.net_total)}</td>
                  {!readOnly && (
                    <td className="row-actions">
                      <button className="icon-button" title="تعديل" onClick={() => onEditRow(row)}>
                        <Pencil size={16} />
                      </button>
                      <button className="icon-button danger" title="حذف" onClick={() => onDeleteRow(row.id)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !statementRows.length && (
        <div className="empty-state">لا توجد بيانات</div>
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
          <tr>{keys.map((key) => <th key={key}>{summaryLabel(key)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {keys.map((key) => <td key={key}>{typeof row[key] === 'number' ? money(row[key]) : text(row[key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  createBackup,
  setMessage,
  busy,
}) {
  const [draftApi, setDraftApi] = useState(apiBase);
  const [password, setPassword] = useState('');
  const [retailTerms, setRetailTerms] = useState(terms.terms_retail || { sections: [] });
  const [corporateTerms, setCorporateTerms] = useState(terms.terms_corporate || { sections: [] });
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({
    username: '',
    display_name: '',
    password: '',
    role: 'user',
    can_create_invoices: 0,
    can_create_payments: 0,
    can_change_status: 0,
  });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUser, setEditingUser] = useState({});
  const [passwordDraft, setPasswordDraft] = useState({ current_password: '', new_password: '' });
  const adminUnlocked = password === '23320001';

  useEffect(() => setDraftApi(apiBase), [apiBase]);
  useEffect(() => {
    setRetailTerms(terms.terms_retail || { sections: [] });
    setCorporateTerms(terms.terms_corporate || { sections: [] });
  }, [terms]);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      try {
        const rows = await api.request('/api/users');
        if (!cancelled) setUsers(rows || []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    }
    loadUsers();
    const timer = currentUser?.role === 'admin' ? window.setInterval(loadUsers, 30000) : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [api, currentUser?.role]);

  async function saveTerms(key, value) {
    try {
      await api.request(`/api/settings/terms/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ password, value }),
      });
      setTerms((current) => ({ ...current, [key === 'corporate' ? 'terms_corporate' : 'terms_retail']: value }));
      setMessage('تم حفظ الشروط والأحكام.');
    } catch (error) {
      setMessage(`لم يتم حفظ الشروط: ${error.message}`);
    }
  }

  async function startHosting() {
    try {
      const data = await api.request('/api/admin/start-hosting', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      const urls = [data.localUrl, ...(data.lanUrls || [])].filter(Boolean).join(' | ');
      setMessage(`تم تفعيل الاستضافة على هذا الجهاز: ${urls}`);
    } catch (error) {
      setMessage(`تعذر تفعيل الاستضافة: ${error.message}`);
    }
  }

  async function addUser(event) {
    event.preventDefault();
    try {
      const user = await api.request('/api/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setUsers((current) => [...current, user]);
      setNewUser({ username: '', display_name: '', password: '', role: 'user', can_create_invoices: 0, can_create_payments: 0, can_change_status: 0 });
      setMessage('تم إضافة المستخدم.');
    } catch (error) {
      setMessage(`تعذر إضافة المستخدم: ${error.message}`);
    }
  }

  async function saveUser(userId) {
    try {
      const updated = await api.request(`/api/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(editingUser),
      });
      setUsers((current) => current.map((user) => (user.id === userId ? { ...user, ...updated } : user)));
      setEditingUserId(null);
      setEditingUser({});
      setMessage('تم تعديل المستخدم.');
    } catch (error) {
      setMessage(`تعذر تعديل المستخدم: ${error.message}`);
    }
  }

  async function deleteUser(userId) {
    if (!window.confirm('إيقاف هذا المستخدم؟')) return;
    try {
      await api.request(`/api/users/${userId}`, { method: 'DELETE' });
      setUsers((current) => current.map((user) => (user.id === userId ? { ...user, is_active: 0 } : user)));
      setMessage('تم إيقاف المستخدم.');
    } catch (error) {
      setMessage(`تعذر إيقاف المستخدم: ${error.message}`);
    }
  }

  async function changeMyPassword(event) {
    event.preventDefault();
    try {
      await api.request(`/api/users/${currentUser.id}/password`, {
        method: 'PUT',
        body: JSON.stringify(passwordDraft),
      });
      setPasswordDraft({ current_password: '', new_password: '' });
      setMessage('تم تغيير كلمة المرور.');
    } catch (error) {
      setMessage(`تعذر تغيير كلمة المرور: ${error.message}`);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel settings-grid">
        <div>
          <div className="panel-head">
            <h2><Server size={18} /> الخادم</h2>
          </div>
          <Field label="Server URL">
            <input dir="ltr" value={draftApi} onChange={(event) => setDraftApi(event.target.value)} placeholder="http://127.0.0.1:4181" />
          </Field>
          <div className="action-row">
            <button type="button" className="primary" title="حفظ عنوان الخادم" onClick={() => setApiBase(draftApi)}>
              <Save size={18} /> حفظ
            </button>
            <button type="button" title="إنشاء نسخة احتياطية من قاعدة البيانات" onClick={createBackup} disabled={busy}>
              <Database size={18} /> نسخة احتياطية
            </button>
            <button type="button" title="تشغيل الخادم على شبكة هذا الجهاز بعد إدخال كلمة مرور الإدارة" onClick={startHosting} disabled={!adminUnlocked || busy}>
              <Server size={18} /> تشغيل الاستضافة
            </button>
          </div>
          <div className="facts">
            <span><HardDrive size={16} /> {health?.dataDir || bootstrap?.dataDir || ' '}</span>
            <span><Database size={16} /> {health?.dbPath || bootstrap?.dbPath || ' '}</span>
            {(health?.lanIps || []).map((ip) => <span key={ip}><Smartphone size={16} /> http://{ip}:{health.port}</span>)}
          </div>
        </div>

        <div>
          <div className="panel-head">
            <h2>المظهر</h2>
          </div>
          <div className="segmented">
            <button type="button" className={themeMode === 'system' ? 'active' : ''} onClick={() => setThemeMode('system')}><Monitor size={17} /> النظام</button>
            <button type="button" className={themeMode === 'light' ? 'active' : ''} onClick={() => setThemeMode('light')}><Sun size={17} /> فاتح</button>
            <button type="button" className={themeMode === 'dark' ? 'active' : ''} onClick={() => setThemeMode('dark')}><Moon size={17} /> داكن</button>
          </div>
          <Field label="كلمة مرور الإدارة">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <span className={adminUnlocked ? 'unlock ok' : 'unlock'}>{adminUnlocked ? 'تم فتح أدوات الإدارة' : 'أدوات الإدارة مقفلة'}</span>
        </div>
      </section>

      <section className="panel users-panel">
        <div className="panel-head">
          <h2><Users size={18} /> المستخدمون</h2>
          <span className="user-chip">{currentUser?.display_name}</span>
        </div>
        <form className="form-grid user-form" onSubmit={changeMyPassword}>
          <Field label="كلمة المرور الحالية">
            <input type="password" value={passwordDraft.current_password} onChange={(event) => setPasswordDraft({ ...passwordDraft, current_password: event.target.value })} />
          </Field>
          <Field label="كلمة المرور الجديدة">
            <input type="password" value={passwordDraft.new_password} onChange={(event) => setPasswordDraft({ ...passwordDraft, new_password: event.target.value })} required />
          </Field>
          <button type="submit"><KeyRound size={18} /> تغيير كلمتي</button>
        </form>
        {currentUser?.role === 'admin' ? (
          <>
            <form className="form-grid user-form" onSubmit={addUser}>
              <Field label="اسم الدخول">
                <input value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} required />
              </Field>
              <Field label="الاسم في التقارير">
                <input value={newUser.display_name} onChange={(event) => setNewUser({ ...newUser, display_name: event.target.value })} placeholder="Eng. Name" required />
              </Field>
              <Field label="كلمة المرور">
                <input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required />
              </Field>
              <Field label="الدور">
                <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  <option value="user">مستخدم</option>
                  <option value="admin">مدير</option>
                </select>
              </Field>
              <label className="check-tile" title="السماح بإنشاء فواتير معتمدة">
                <input type="checkbox" checked={!!newUser.can_create_invoices} onChange={(event) => setNewUser({ ...newUser, can_create_invoices: event.target.checked ? 1 : 0 })} />
                <span>إنشاء فواتير معتمدة</span>
              </label>
              <label className="check-tile" title="السماح بتسجيل دفعات">
                <input type="checkbox" checked={!!newUser.can_create_payments} onChange={(event) => setNewUser({ ...newUser, can_create_payments: event.target.checked ? 1 : 0 })} />
                <span>تسجيل دفعات</span>
              </label>
              <label className="check-tile" title="السماح بتغيير حالة المستند">
                <input type="checkbox" checked={!!newUser.can_change_status} onChange={(event) => setNewUser({ ...newUser, can_change_status: event.target.checked ? 1 : 0 })} />
                <span>تغيير حالة المستند</span>
              </label>
              <button type="submit" className="primary"><UserPlus size={18} /> إضافة مستخدم</button>
            </form>
            <div className="table-scroll compact-table">
              <table>
                <thead>
                  <tr><th>ID</th><th>اسم الدخول</th><th>اسم التقرير</th><th>الدور</th><th>الحالة</th><th>آخر ظهور</th><th>وقت العمل</th><th>فواتير</th><th>دفعات</th><th>حالة المستند</th><th>كلمة مرور جديدة</th><th></th></tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.id}</td>
                      {editingUserId === user.id ? (
                        <>
                          <td><input value={editingUser.username ?? user.username} onChange={(event) => setEditingUser({ ...editingUser, username: event.target.value })} /></td>
                          <td><input value={editingUser.display_name ?? user.display_name} onChange={(event) => setEditingUser({ ...editingUser, display_name: event.target.value })} /></td>
                          <td>
                            <select value={editingUser.role ?? user.role} onChange={(event) => setEditingUser({ ...editingUser, role: event.target.value })}>
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                            </select>
                          </td>
                          <td>
                            <select value={String(editingUser.is_active ?? user.is_active)} onChange={(event) => setEditingUser({ ...editingUser, is_active: event.target.value === '1' ? 1 : 0 })}>
                              <option value="1">نشط</option>
                              <option value="0">موقوف</option>
                            </select>
                          </td>
                          <td>{formatUserDateTime(user.last_seen_at)}</td>
                          <td>{user.work_time_label || workTimeLabel(user.work_time_seconds)}</td>
                          <td><input type="checkbox" checked={!!(editingUser.can_create_invoices ?? user.can_create_invoices)} onChange={(event) => setEditingUser({ ...editingUser, can_create_invoices: event.target.checked ? 1 : 0 })} /></td>
                          <td><input type="checkbox" checked={!!(editingUser.can_create_payments ?? user.can_create_payments)} onChange={(event) => setEditingUser({ ...editingUser, can_create_payments: event.target.checked ? 1 : 0 })} /></td>
                          <td><input type="checkbox" checked={!!(editingUser.can_change_status ?? user.can_change_status)} onChange={(event) => setEditingUser({ ...editingUser, can_change_status: event.target.checked ? 1 : 0 })} /></td>
                          <td><input type="password" value={editingUser.password || ''} onChange={(event) => setEditingUser({ ...editingUser, password: event.target.value })} /></td>
                          <td className="row-actions">
                            <button type="button" className="icon-button" title="حفظ" onClick={() => saveUser(user.id)}><Save size={16} /></button>
                            <button type="button" className="icon-button" title="إلغاء" onClick={() => { setEditingUserId(null); setEditingUser({}); }}><Trash2 size={16} /></button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{user.username}</td>
                          <td>
                            <span className="presence-name">
                              <span
                                className={user.is_online ? 'presence-dot online' : 'presence-dot offline'}
                                title={user.is_online ? 'Online' : 'Offline'}
                              />
                              <span>{user.display_name}</span>
                            </span>
                          </td>
                          <td>{user.role}</td>
                          <td>{user.is_active ? 'نشط' : 'موقوف'}</td>
                          <td>{formatUserDateTime(user.last_seen_at)}</td>
                          <td>{user.work_time_label || workTimeLabel(user.work_time_seconds)}</td>
                          <td>{user.can_create_invoices ? 'نعم' : '-'}</td>
                          <td>{user.can_create_payments ? 'نعم' : '-'}</td>
                          <td>{user.can_change_status ? 'نعم' : '-'}</td>
                          <td> </td>
                          <td className="row-actions">
                            <button type="button" className="icon-button" title="تعديل" onClick={() => { setEditingUserId(user.id); setEditingUser({ ...user, password: '' }); }}><Pencil size={16} /></button>
                            <button type="button" className="icon-button danger" title="إيقاف" onClick={() => deleteUser(user.id)}><Trash2 size={16} /></button>
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
        <TermEditor title="شروط الأفراد" value={retailTerms} onChange={setRetailTerms} onSave={() => saveTerms('retail', retailTerms)} />
        <TermEditor title="شروط الشركات" value={corporateTerms} onChange={setCorporateTerms} onSave={() => saveTerms('corporate', corporateTerms)} />
      </section>
    </div>
  );
}

function TermEditor({ title, value, onChange, onSave }) {
  const sections = value.sections || [];
  function updateSection(index, patch) {
    const next = sections.map((section, itemIndex) => (itemIndex === index ? { ...section, ...patch } : section));
    onChange({ ...value, sections: next });
  }
  function addSection() {
    onChange({ ...value, sections: [...sections, { title: '', lines: [''] }] });
  }
  function removeSection(index) {
    onChange({ ...value, sections: sections.filter((_, itemIndex) => itemIndex !== index) });
  }
  return (
    <section className="panel term-editor">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="action-row">
          <button type="button" onClick={addSection}><Plus size={17} /> قسم</button>
          <button type="button" className="primary" onClick={onSave}><Check size={17} /> حفظ</button>
        </div>
      </div>
      <div className="term-sections">
        {sections.map((section, index) => (
          <div className="term-section" key={index}>
            <Field label="العنوان">
              <input value={section.title || ''} onChange={(event) => updateSection(index, { title: event.target.value })} />
            </Field>
            <Field label="البنود">
              <textarea value={(section.lines || []).join('\n')} onChange={(event) => updateSection(index, { lines: event.target.value.split('\n') })} />
            </Field>
            <button className="danger-text" type="button" onClick={() => removeSection(index)}>حذف القسم</button>
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

function ComboField({ label, value, options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const cleanOptions = uniqueValues(options);
  const typed = normalizeArabic(value || '');
  const shownOptions = typed
    ? cleanOptions.filter((option) => normalizeArabic(option).includes(typed))
    : cleanOptions;
  const listId = useMemo(() => `combo-${Math.random().toString(36).slice(2)}`, []);
  return (
    <label className="field combo-field" title={`${label} - اكتب للبحث أو اختر من البيانات السابقة`}>
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
        {shownOptions.map((option) => <option key={option} value={option} />)}
      </datalist>
      {open && shownOptions.length > 0 && (
        <div className="inline-suggestions">
          {shownOptions.slice(0, 10).map((option) => (
            <button key={option} type="button" onMouseDown={(event) => {
              event.preventDefault();
              onChange(option);
              setOpen(false);
            }}>
              {option}
            </button>
          ))}
        </div>
      )}
      <select className="combo-picker" value="" onChange={(event) => {
        if (event.target.value) onChange(event.target.value);
      }}>
        <option value="">اختيار من البيانات السابقة</option>
        {shownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function documentTypeLabel(type) {
  return {
    price_offer: 'عرض سعر',
    invoice: 'فاتورة',
    contractor_certificate: 'مستخلص مقاول',
    payment: 'تحصيل',
    ledger: 'كشف حساب',
  }[type] || type || ' ';
}

function statusLabel(status) {
  return {
    draft: 'مسودة',
    approved: 'معتمد',
    closed: 'مغلق',
  }[status] || status || ' ';
}

function summaryLabel(key) {
  return {
    customer: 'العميل',
    project: 'المشروع',
    building_unit: 'المبنى/الوحدة',
    work_type: 'نوع الأعمال',
    rows: 'عدد القيود',
    area_m2: 'الأمتار المربعة',
    quantity: 'الكمية',
    average_rate: 'متوسط الفئة',
    gross_total: 'الإجمالي',
    vat_amount: 'ضريبة 14%',
    social_insurance_amount: 'تأمينات اجتماعية',
    stamp_amount: 'دمغة',
    works_insurance_amount: 'تأمين أعمال',
    final_insurance_amount: 'تأمين نهائي',
    contractor_tax_amount: 'ضريبة مقاولات',
    net_total: 'الصافي',
  }[key] || key;
}

createRoot(document.getElementById('root')).render(<App />);
