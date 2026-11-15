const MODEL_VERSION = 2;

const labels = {
  en: {
    draft: 'Draft - for review', customer: 'Customer', project: 'Project', location: 'Location',
    customer_code: 'Customer code', project_code: 'Project code', address: 'Address',
    site: 'Site address', tax_no: 'Tax registration', registration: 'Commercial registration',
    attention: 'Attention', contract_ref: 'Contract / PO', contract_date: 'Contract date',
    certificate: 'Certificate', progress_type: 'Progress certificate', final_type: 'Final certificate',
    correction_type: 'Correction certificate', void_type: 'Void certificate', reopen_type: 'Reopening certificate',
    revision: 'Revision', issue_date: 'Issue date',
    work_from: 'Period start', work_to: 'Work cutoff', collection_cutoff: 'Collections cutoff',
    currency: 'Currency', title: 'Reference', notes: 'Certificate note', work_type: 'Work type', work_item: 'Item',
    description: 'Works', width: 'Width', length: 'Length', height: 'Height',
    dimension_unit: 'Measure unit', count: 'Count', billed_quantity: 'Quantity', unit: 'Unit',
    rate: 'Rate', agreed_amount: 'Agreed amount', progress: 'Progress', note: 'Note',
    last_current: 'Last certificate current', previous: 'Previously certified', current: 'Current certificate',
    cumulative: 'Certified to date', cover: 'Consolidated work', detail: 'Work details',
    subtotal: 'Work type subtotal', total: 'Total work', finance: 'Settlement', basis: 'Basis',
    current_payable: 'Current net payable', cumulative_payable: 'Net payable to date',
    current_credit: 'Current credit', cumulative_credit: 'Credit to date',
    ordinary_collections: 'Ordinary collections', advance_recovery: 'Advance recovery',
    settled_work: 'Certified work', receipts: 'Payment details', advance_receipts: 'Advance payments received',
    collection_received: 'Receipt date', collection_cleared: 'Clearance date',
    received_date: 'Received', method: 'Method', reference: 'Reference', amount: 'Amount',
    receipt_type: 'Type', status: 'Status', payment_details_through: 'Payment details through',
    page: 'Page', of: 'of', no_lines: 'No work rows',
    vat: 'VAT', retention: 'Retention', contractor_withholding: 'Contractor withholding',
    reversed_advance_recovery: 'Advance recovery released', works_insurance: 'Works insurance',
    engineering_stamp: 'Engineering stamp', social_insurance: 'Social insurance',
    adjustment: 'Adjustment', ordinary: 'Ordinary receipt', receipt: 'Payment', advance: 'Advance',
    reversal: 'Reversal', cleared: 'Cleared', received: 'Received', reversed: 'Reversed',
    pending: 'Pending', current_work: 'Current work', cumulative_work: 'Cumulative work',
    previous_work: 'Previous work', fixed: 'Fixed amount', running: 'Running net', gross: 'Current work', other_rule: 'Other adjustment',
  },
  ar: {
    draft: 'مسودة - للمراجعة', customer: 'العميل', project: 'المشروع', location: 'الموقع',
    customer_code: 'كود العميل', project_code: 'كود المشروع', address: 'العنوان',
    site: 'عنوان الموقع', tax_no: 'التسجيل الضريبي', registration: 'السجل التجاري',
    attention: 'عناية', contract_ref: 'العقد / أمر الشراء', contract_date: 'تاريخ العقد',
    certificate: 'المستخلص', progress_type: 'مستخلص دوري', final_type: 'مستخلص ختامي',
    correction_type: 'مستخلص تصحيح', void_type: 'مستخلص إلغاء', reopen_type: 'مستخلص إعادة فتح',
    revision: 'المراجعة', issue_date: 'تاريخ الإصدار',
    work_from: 'بداية الفترة', work_to: 'نهاية الأعمال', collection_cutoff: 'نهاية فترة التحصيلات',
    currency: 'العملة', title: 'المرجع', notes: 'ملاحظة المستخلص', work_type: 'نوع العمل', work_item: 'البند',
    description: 'الأعمال', width: 'العرض', length: 'الطول', height: 'الارتفاع',
    dimension_unit: 'وحدة القياس', count: 'العدد', billed_quantity: 'الكمية', unit: 'الوحدة',
    rate: 'سعر الوحدة', agreed_amount: 'القيمة المتفق عليها', progress: 'نسبة الإنجاز', note: 'ملاحظة',
    last_current: 'جاري المستخلص السابق', previous: 'الأعمال السابقة المعتمدة', current: 'جاري المستخلص',
    cumulative: 'إجمالي الأعمال المعتمدة', cover: 'ملخص الأعمال', detail: 'تفاصيل الأعمال',
    subtotal: 'إجمالي نوع العمل', total: 'إجمالي الأعمال', finance: 'التسوية المالية', basis: 'الأساس',
    current_payable: 'صافي المستحق للفترة', cumulative_payable: 'صافي المستحق حتى تاريخه',
    current_credit: 'رصيد دائن للفترة', cumulative_credit: 'رصيد دائن حتى تاريخه',
    ordinary_collections: 'التحصيلات العادية', advance_recovery: 'استرداد الدفعة المقدمة',
    settled_work: 'الأعمال المعتمدة', receipts: 'تفاصيل الدفعات', advance_receipts: 'الدفعات المقدمة المستلمة',
    collection_received: 'تاريخ الاستلام', collection_cleared: 'تاريخ التسوية',
    received_date: 'تاريخ الاستلام', method: 'طريقة التحصيل', reference: 'المرجع', amount: 'المبلغ',
    receipt_type: 'النوع', status: 'الحالة', payment_details_through: 'تفاصيل الدفعات حتى',
    page: 'صفحة', of: 'من', no_lines: 'لا توجد بنود أعمال',
    vat: 'ضريبة القيمة المضافة', retention: 'احتجاز الضمان', contractor_withholding: 'الخصم تحت حساب الضريبة',
    reversed_advance_recovery: 'رد استرداد الدفعة المقدمة', works_insurance: 'تأمين الأعمال',
    engineering_stamp: 'الدمغة الهندسية', social_insurance: 'التأمينات الاجتماعية',
    adjustment: 'تسوية', ordinary: 'تحصيل عادي', receipt: 'تحصيل', advance: 'دفعة مقدمة',
    reversal: 'عكس تحصيل', cleared: 'تمت التسوية', received: 'تم الاستلام', reversed: 'معكوس',
    pending: 'معلق', current_work: 'الأعمال الجارية', cumulative_work: 'إجمالي الأعمال',
    previous_work: 'الأعمال السابقة', fixed: 'مبلغ ثابت', running: 'صافي القيمة المرحلية', gross: 'الأعمال الجارية', other_rule: 'تسوية أخرى',
  },
};

function text(value) {
  return ['string', 'number', 'bigint'].includes(typeof value) ? String(value).trim().replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) <= 0x669 ? 0x660 : 0x6f0))) : '';
}

function number(value) {
  if (value == null || text(value) === '') return null;
  const parsed = Number(text(value).replace(/٫/g, '.').replace(/٬/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function nameForPrint(record, locale) {
  const official = text(record.name || record.legal_name || record.display_name);
  const alternate = text(record.alternate_name);
  const arabic = /\p{Script=Arabic}/u;
  const matches = (value) => locale === 'ar' ? arabic.test(value) : /[a-z]/i.test(value) && !arabic.test(value);
  return text(record['name_' + locale]) || (!matches(official) && matches(alternate) ? alternate : official);
}

function metadata(key, value, { wide = false, isolated = false, required = false } = {}) {
  return { key, value: text(value), wide, isolated, required };
}

function visibleMetadata(fields, choices, translations) {
  const aliases = {
    address: ['customer_address'], site: ['project_address'],
    attention: ['customer_contact'], tax_no: ['customer_tax_no'],
  };
  return fields.filter((field) => {
    const keys = [field.key, ...(aliases[field.key] || [])];
    return field.value !== '' && (field.required || (Array.isArray(choices)
      ? keys.some((key) => choices.includes(key))
      : keys.every((key) => choices?.[key] !== false)));
  }).map((field) => ({ ...field, label: translations[field.key] }));
}

function money(value) {
  return number(value) ?? 0;
}

function asCents(value) {
  return Math.round(money(value) * 100);
}

function financialRollup(rows, keys) {
  return Object.fromEntries(keys.map((key) => [key, rows.reduce((sum, row) => sum + asCents(row[key]), 0) / 100]));
}

function column(key, weight, kind = 'text') {
  return { key, weight, kind };
}

function detailColumns(lines, moneyKeys, sharedLocation, translations) {
  const area = lines.some((line) => line.mode === 'area');
  const linear = lines.some((line) => line.mode === 'linear');
  const measured = area || linear;
  const pricedQuantity = lines.some((line) => ['area', 'linear', 'count', 'direct'].includes(line.mode));
  const populated = (key) => lines.some((line) => text(line[key]) !== '');
  const columns = [
    !sharedLocation && populated('location') && column('location', 14),
    populated('work_item') && column('work_item', 12),
    column('description', 27),
    measured && { ...column('width', 8, 'number'), label: translations[area ? 'width' : 'length'] },
    area && column('height', 8, 'number'),
    measured && populated('dimension_unit') && column('dimension_unit', 7),
    measured && lines.some((line) => ['area', 'linear'].includes(line.mode) && number(line.count) !== null) && column('count', 7, 'number'),
    (pricedQuantity || populated('billed_quantity')) && column('billed_quantity', 10, 'number'),
    (pricedQuantity || populated('unit')) && column('unit', 7),
    (pricedQuantity || populated('rate')) && column('rate', 11, 'money'),
    populated('agreed_amount') && column('agreed_amount', 14, 'money'),
    populated('progress') && column('progress', 13, 'percent'),
    ...moneyKeys.map((key) => column(key, 15, 'money')),
    populated('note') && column('note', 18),
  ];
  return columns.filter(Boolean).map((entry) => ({ label: translations[entry.key], ...entry }));
}

function buildCertificateDocument(input, { variant = 'customer' } = {}) {
  const header = input.header || {};
  const locale = (header.locale || input.locale) === 'ar' ? 'ar' : 'en';
  const historical = input.status === 'historical';
  const issued = historical || input.status === 'issued' || Boolean(input.official_number);
  const t = { ...labels[locale],
    stamp: locale === 'ar' ? 'ختم الشركة' : 'Company stamp', prepared: locale === 'ar' ? 'أعد التقرير' : 'Prepared by' };
  const project = input.project || {};
  const customer = input.customer || {};
  const issuer = input.issuer || input.branding || {};
  const issuerEn = text(issuer.companyNameEn || issuer.name_en);
  const issuerAr = text(issuer.companyNameAr || issuer.name_ar);
  const issuerName = issuerEn || nameForPrint(issuer, 'en') || issuerAr || text(issuer.companyName || issuer.company_name);
  const issuerAlternate = issuerAr;
  const choices = header.optional_fields;
  const officialNumber = text(input.official_number ?? (historical ? input.legacy_number : ''));
  const watermark = issued ? '' : variant === 'customer' ? (locale === 'ar' ? 'مسودة' : 'Draft') : t.draft;
  const certificateType = t[`${header.type || 'progress'}_type`] || t.progress_type;
  const currency = /^[A-Z]{3}$/.test(text(header.currency)) ? text(header.currency) : 'EGP';
  const totals = input.totals || {};
  const comparable = totals.last_current != null && (input.baseline != null || input.status === 'issued');
  const locations = new Set((input.lines || []).map((line) => text(line.location)));
  const commonLocation = text(header.location || header.location_name || (locations.size === 1 ? [...locations][0] : ''));
  const choiceAllowsLocation = Array.isArray(choices) ? choices.includes('location') : choices?.location !== false;
  const sharedLocation = choiceAllowsLocation ? commonLocation : '';
  const lines = (input.lines || []).map((line) => {
    const measured = line.mode === 'area' || line.mode === 'linear';
    return {
      id: text(line.id), mode: text(line.mode), work_type: text(line.work_type),
      work_item: text(line.work_item), location: text(line.location), description: text(line.description),
      width: measured ? number(line.width) : null,
      height: line.mode === 'area' ? number(line.height) : null,
      dimension_unit: measured ? text(line.dimension_unit) : '',
      count: measured ? number(line.count) : null,
      billed_quantity: number(line.billed_quantity ?? line.quantity), unit: text(line.unit),
      rate: number(line.rate), agreed_amount: number(line.agreed_amount), progress: number(line.progress) ?? 100,
      note: text(line.note), last_current: comparable ? money(line.last_current) : null,
      previous: money(line.previous), current: money(line.current), cumulative: money(line.cumulative),
    };
  });
  const moneyKeys = historical ? ['current'] : comparable
    ? ['last_current', 'previous', 'current', 'cumulative']
    : ['previous', 'current', 'cumulative'];
  const columns = detailColumns(lines, moneyKeys, locations.size < 2 && sharedLocation && [...locations].every((name) => !name || name === sharedLocation), t);
  const groups = new Map();
  const detailGroups = [];
  for (const line of lines) {
    if (!groups.has(line.work_type)) groups.set(line.work_type, []);
    groups.get(line.work_type).push(line);
    const name = header.group_work_types ? line.work_type : '';
    let group = detailGroups.at(-1);
    if (group?.name !== name) {
      group = { name, lines: [] };
      detailGroups.push(group);
    }
    group.lines.push(line);
  }
  const components = totals.components || [];
  const recordedCollections = [
    ...(totals.advance_receipts ? [{key:'advance_receipts', cumulative:money(totals.advance_receipts)}] : []),
    ...(totals.ordinary_collections == null || (historical && !totals.ordinary_collections) ? [] : [{
      key:'ordinary_collections',
      basis:text(t['collection_' + input.rule_settings?.collections_basis]),
      current:totals.current_collections == null ? null : -money(totals.current_collections),
      cumulative:-money(totals.ordinary_collections),
    }]),
  ];
  const financeRows = (historical ? recordedCollections : [
    { key: 'settled_work', previous: money(totals.previous), current: money(totals.current), cumulative: money(totals.cumulative) },
    ...components.filter((entry) => (entry.category || entry.kind) !== 'advance_recovery').map((entry) => ({
      label: text(entry.label || entry.name || t[entry.category || entry.kind] || t.other_rule),
      basis: text(t[entry.basis] || entry.basis),
      basisValue: number(entry.basis_value ?? entry.base),
      previous: number(entry.previous),
      current: money(entry.current ?? entry.amount ?? entry.value),
      cumulative: number(entry.cumulative),
    })),
    ...(totals.advance_recovery == null ? [] : [{
      key: 'advance_recovery',
      current: -money(totals.advance_recovery),
      cumulative: totals.cumulative_advance_recovery == null ? null : -money(totals.cumulative_advance_recovery),
      basis: text(t[components.find((entry) => (entry.category || entry.kind) === 'advance_recovery')?.basis]),
    }]),
    ...(totals.reversed_advance_recovery || totals.current_reversed_advance_recovery ? [{
      key: 'reversed_advance_recovery',
      current: number(totals.current_reversed_advance_recovery),
      cumulative: number(totals.reversed_advance_recovery),
    }] : []),
    ...recordedCollections,
    {
      key: money(totals.current_payable) < 0 ? 'current_credit' : 'current_payable',
      current: Math.abs(money(totals.current_payable)), emphasis: true,
    },
    {
      key: money(totals.cumulative_payable) < 0 ? 'cumulative_credit' : 'cumulative_payable',
      cumulative: Math.abs(money(totals.cumulative_payable)), emphasis: true,
    },
  ]).map((entry) => ({ ...entry, label: entry.label || t[entry.key] }));

  const receiptColumns = [
    column('received_date', 11), column('receipt_type', 10),
    ...(variant === 'internal' ? [column('method', 10), column('reference', 20), column('status', 10)] : []),
    column('amount', 11, 'money'),
  ].map((entry) => ({ ...entry, label: t[entry.key] }));
  const receipts = (input.include_receipts ?? variant === 'internal') ? (input.receipts || []).map((receipt) => ({
    received_date: text(receipt.received_date || receipt.received_at || receipt.date).slice(0, 10),
    ...(variant === 'internal' ? {method:text(t[receipt.method] || receipt.method), reference:text(receipt.reference)} : {}),
    amount: money(receipt.amount), receipt_type: text(t[receipt.kind || receipt.type] || receipt.kind || receipt.type),
    status: text(t[receipt.status] || receipt.status),
    allocation: number(receipt.allocated_amount ?? receipt.allocation),
  })) : [];

  const fieldGroups = [
    [metadata('customer', nameForPrint(customer, locale), { required: true, wide: true }),
      metadata('customer_code', customer.code, { isolated: true }),
      metadata('tax_no', customer.tax_no, { isolated: true }),
      metadata('registration', customer.registration_no || customer.commercial_no, { isolated: true }),
      metadata('address', customer.address || customer.billing_address, { wide: true }),
      metadata('attention', customer.attention || customer.print_contact, { wide: true })],
    [metadata('project', nameForPrint(project, locale), { required: true, wide: true }),
      metadata('project_code', project.code, { isolated: true }),
      metadata('site', project.site_address || project.address, { wide: true }),
      metadata('location', sharedLocation, { wide: true }),
      metadata('contract_ref', header.contract_ref || project.contract_ref, { isolated: true }),
      metadata('contract_date', header.contract_date || project.contract_date, { isolated: true })],
    [metadata('certificate', [certificateType, officialNumber].filter(Boolean).join(' · '), { required: true, wide: true }),
      metadata('revision', variant === 'internal' ? input.revision : '', { isolated: true }),
      metadata('issue_date', text(input.issued_at || header.issue_date).slice(0, 10), { isolated: true }),
      metadata('work_from', header.work_from, { isolated: true }),
      metadata('work_to', header.work_to, { isolated: true }),
      metadata('collection_cutoff', header.collection_cutoff || (historical && receipts.length ? header.work_to : ''), { isolated: true }),
      metadata('payment_details_through', receipts.length ? input.payment_details_through : '', {isolated:true}),
      metadata('currency', currency, { isolated: true }),
      metadata('title', header.title),
      metadata('notes', choices?.notes === true || choices?.includes?.('notes') ? header.notes : '', { wide: true })],
  ].map((group) => visibleMetadata(group, choices, t)).filter((group) => group.length);
  const outputAliases = { automatic: 'auto', summary: 'summary_details', 'summary+details': 'summary_details',
    details: 'detail_only', detail: 'detail_only', 'detail-only': 'detail_only', cover: 'summary_details' };
  const outputMode = outputAliases[header.output_mode] || header.output_mode || 'auto';
  const measured = lines.some((line) => line.mode === 'area' || line.mode === 'linear');

  return {
    modelVersion: MODEL_VERSION, locale, direction: locale === 'ar' ? 'rtl' : 'ltr', labels: t,
    variant, issued, historical, watermark, certificateType, officialNumber, revision: variant === 'internal' ? input.revision ?? '' : '',
    currency, outputMode, measured, paper: header.paper_size === 'Letter' ? 'Letter' : 'A4',
    landscape: measured || columns.length > 9,
    issuer: {
      name: issuerName,
      alternate: issuerAlternate !== issuerName ? issuerAlternate : '',
      website: text(issuer.website),
      shortName: text(issuer.companyAbbreviation || issuer.abbreviation),
      logo: /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(issuer.logo_data_url || issuer.logoDataUrl || issuer.logoDataUri || '')
        ? (issuer.logo_data_url || issuer.logoDataUrl || issuer.logoDataUri) : '',
    },
    preparedBy: text(input.prepared_by), appVersion: text(input.app_version),
    signatures: (input.rule_settings?.signatures || []).map((person) => ({ name: text(person.name), title: text(person.title) })).filter((person) => person.name),
    showGroupSubtotals: Boolean(header.group_work_types && header.show_group_subtotals),
    identities: { customer: nameForPrint(customer, locale), project: nameForPrint(project, locale) },
    fieldGroups, columns, moneyKeys, lines, receipts, receiptColumns,
    detailGroups: detailGroups.map(({ name, lines: groupLines }) => ({
      name, lines: groupLines, totals: financialRollup(groupLines, moneyKeys),
    })),
    coverRows: header.group_work_types ? [...groups].filter(([name]) => name)
      .map(([name, groupLines]) => ({ name, ...financialRollup(groupLines, moneyKeys) })) : [],
    workTotals: financialRollup(lines, moneyKeys), financeRows,
  };
}

function documentFilename(model, extension) {
  const name = [model.issued ? model.officialNumber || 'Certificate' : 'Draft', model.identities.project,
    model.revision === '' ? '' : `R${model.revision}`, model.variant === 'internal' ? 'Internal' : '']
    .map(text).filter(Boolean).join(' - ').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 145).toWellFormed();
  return `${name || 'Certificate'}.${extension}`;
}

module.exports = { buildCertificateDocument, documentFilename, MODEL_VERSION };
