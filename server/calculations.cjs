function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', '\u0646\u0639\u0645'].includes(text);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function excelSerialToIso(value) {
  const n = numberOrNull(value);
  if (!n) return value || null;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + n * 86400000);
  return date.toISOString().slice(0, 10);
}

function formatOperationNo(serial) {
  const n = numberOrNull(serial);
  if (n === null) return '';
  return String(Math.trunc(n)).padStart(6, '0');
}

function normalizeUnitCode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['sqm', 'm2', 'meter2', '\u0645\u00b2', '\u0645\u0662'].includes(text)) return 'sqm';
  if (['lm', 'linear', 'long', '\u0645.\u0637', '\u0645\u0637', '\u0645\u062a\u0631 \u0637\u0648\u0644\u064a'].includes(text)) return 'lm';
  if (['count', 'number', 'no', '\u0639\u062f\u062f'].includes(text)) return 'count';
  return 'sqm';
}

function normalizeMeasurementMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['engineering', 'engineer', '\u0647\u0646\u062f\u0633\u064a'].includes(text)) return 'engineering';
  return 'standard';
}

function composeStatementText(input = {}) {
  return [
    input.description,
    input.glass_spec,
    input.profile_spec,
    input.color,
  ].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
}

function calculateItem(input = {}) {
  const collectionAmount = numberOrZero(input.collection_amount);
  const itemCount = numberOrZero(input.item_count || input.count);
  const widthCm = numberOrZero(input.width_cm);
  const heightCm = numberOrZero(input.height_cm);
  const totalQuantity = numberOrZero(input.total_quantity);
  const rate = numberOrZero(input.rate);
  const fixedTotal = numberOrZero(input.building_unit_price);
  const unitCode = normalizeUnitCode(input.unit_code || input.unit);
  const measurementMode = normalizeMeasurementMode(input.measurement_mode || input.calculation_method);

  let areaM2 = 0;
  let quantity = 0;

  if (collectionAmount) {
    quantity = 0;
  } else if (!heightCm && !widthCm) {
    quantity = round2(totalQuantity);
  } else if (unitCode === 'lm') {
    quantity = round2((widthCm / 100) * itemCount);
  } else if (unitCode === 'count') {
    quantity = totalQuantity || itemCount || 1;
  } else {
    const itemArea = (heightCm / 100) * (widthCm / 100);
    areaM2 = itemArea * (itemCount || 1);
    if (measurementMode === 'engineering') {
      quantity = round2(areaM2);
    } else {
      quantity = itemArea < 1 ? (itemCount || 1) : round2(areaM2);
    }
  }

  if (!areaM2 && widthCm && heightCm) {
    areaM2 = round2((heightCm / 100) * (widthCm / 100) * (itemCount || 1));
  }

  let cost = 0;
  if (!collectionAmount) {
    cost = quantity === 0 ? totalQuantity * rate : (fixedTotal || quantity * rate);
  }

  const unitPrice = itemCount && cost ? cost / itemCount : 0;
  const grossTotal = collectionAmount ? 0 : cost;
  const legacyDiscountAmount = numberOrZero(input.discount_amount);

  const contractorTaxAmount = boolValue(input.contractor_tax_enabled) ? grossTotal * 0.01 : 0;
  const vatBase = Math.max(grossTotal - contractorTaxAmount, 0);
  const vatAmount = boolValue(input.vat_enabled)
    ? (collectionAmount ? 0 : (vatBase < 1 ? 0 : vatBase * 0.14))
    : 0;
  const postVatBase = vatBase + vatAmount;
  const socialInsuranceAmount = boolValue(input.social_insurance_enabled)
    ? postVatBase * 0.036
    : 0;
  const stampAmount = boolValue(input.stamp_enabled)
    ? postVatBase * 0.001
    : 0;
  const worksInsuranceAmount = boolValue(input.works_insurance_enabled)
    ? postVatBase * 0.05
    : 0;
  const finalInsuranceAmount = boolValue(input.final_insurance_enabled)
    ? postVatBase * 0.05
    : 0;

  const netTotal = collectionAmount
    ? -Math.abs(collectionAmount)
    : postVatBase
      - socialInsuranceAmount
      - stampAmount
      - finalInsuranceAmount
      - worksInsuranceAmount
      + legacyDiscountAmount;

  return {
    unit_code: unitCode,
    measurement_mode: measurementMode,
    quantity: round2(quantity),
    cost: round2(cost),
    unit_price: round2(unitPrice),
    gross_total: round2(grossTotal),
    vat_amount: round2(vatAmount),
    social_insurance_amount: round2(socialInsuranceAmount),
    stamp_amount: round2(stampAmount),
    works_insurance_amount: round2(worksInsuranceAmount),
    final_insurance_amount: round2(finalInsuranceAmount),
    contractor_tax_amount: round2(contractorTaxAmount),
    discount_amount: round2(legacyDiscountAmount),
    net_total: round2(netTotal),
    tax_inclusive_rate: round2((rate - (boolValue(input.contractor_tax_enabled) ? rate * 0.01 : 0)) * (boolValue(input.vat_enabled) ? 1.14 : 1)),
    rate_discount: 0,
    area_m2: round2(areaM2),
    statement_text: composeStatementText(input),
  };
}

module.exports = {
  boolValue,
  calculateItem,
  composeStatementText,
  excelSerialToIso,
  formatOperationNo,
  normalizeMeasurementMode,
  normalizeUnitCode,
  numberOrNull,
  numberOrZero,
  round2,
};
