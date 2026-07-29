// Flattens an Orderful 850 (Purchase Order) message into a clean order object.
// Input is the JSON returned by GET /v3/transactions/{id}/message.

const first = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : undefined);

// EDI date YYYYMMDD -> ISO YYYY-MM-DD.
function isoDate(edi) {
  if (!edi || edi.length !== 8) return edi ?? null;
  return `${edi.slice(0, 4)}-${edi.slice(4, 6)}-${edi.slice(6, 8)}`;
}

// A PO1 line repeats product IDs as productServiceIDQualifier / productServiceID,
// then ...Qualifier1 / ...ID1, etc. Collapse them into a { qualifier: id } map.
function productIds(item) {
  const ids = {};
  for (const key of Object.keys(item)) {
    const m = key.match(/^productServiceIDQualifier(\d*)$/);
    if (!m) continue;
    const qualifier = item[key];
    const value = item[`productServiceID${m[1]}`];
    if (qualifier && value) ids[qualifier] = value;
  }
  return ids;
}

function party(n1Loop, code) {
  const entry = (n1Loop ?? []).find(
    (n) => first(n.partyIdentification)?.entityIdentifierCode === code,
  );
  if (!entry) return null;
  const id = first(entry.partyIdentification);
  const loc = first(entry.partyLocation);
  const geo = first(entry.geographicLocation);
  return {
    name: id?.name ?? null,
    code: id?.identificationCode ?? null,
    address: loc?.addressInformation ?? null,
    city: geo?.cityName ?? null,
    state: geo?.stateOrProvinceCode ?? null,
    zip: geo?.postalCode ?? null,
    country: geo?.countryCode ?? null,
  };
}

// Qualifiers we care about in the DTM (date/time reference) segment.
const DATE_QUALIFIERS = { '037': 'shipBy', '038': 'deliverBy', '002': 'requestedDelivery' };

export function parse850(message) {
  const set = first(message?.transactionSets);
  if (!set) throw new Error('No transaction set found in 850 message');

  const beg = first(set.beginningSegmentForPurchaseOrder) ?? {};
  const terms = first(set.termsOfSaleDeferredTermsOfSale);

  const dates = {};
  for (const dtm of set.dateTimeReference ?? []) {
    const field = DATE_QUALIFIERS[dtm.dateTimeQualifier];
    if (field) dates[field] = isoDate(dtm.date);
  }

  const charges = (set.SAC_loop ?? []).map((sac) => {
    const s = first(sac.servicePromotionAllowanceOrChargeInformation) ?? {};
    return {
      type: s.allowanceOrChargeIndicatorCode === 'C' ? 'charge' : 'allowance',
      code: s.servicePromotionAllowanceOrChargeCode ?? null,
      description: s.description ?? null,
      amount: s.amount != null ? Number(s.amount) : null,
    };
  });

  const lines = (set.PO1_loop ?? []).map((po1) => {
    const base = first(po1.baselineItemData) ?? {};
    const ids = productIds(base);
    return {
      line: base.assignedIdentification ?? null,
      sku: ids.SK ?? null,
      upc: ids.UP ?? null,
      qty: base.quantity != null ? Number(base.quantity) : null,
      uom: base.unitOrBasisForMeasurementCode ?? null,
      unitPrice: base.unitPrice != null ? Number(base.unitPrice) : null,
      description: first(first(po1.PID_loop)?.productItemDescription)?.description ?? null,
    };
  });

  const totals = first(first(set.CTT_loop)?.transactionTotals) ?? {};

  return {
    poNumber: beg.purchaseOrderNumber ?? null,
    poTypeCode: beg.purchaseOrderTypeCode ?? null,
    orderDate: isoDate(beg.date),
    terms: terms?.description ?? null,
    ...dates,
    buyer: party(set.N1_loop, 'BY'),
    shipTo: party(set.N1_loop, 'ST'),
    billTo: party(set.N1_loop, 'BT'),
    charges,
    lines,
    totals: {
      lineItems: totals.numberOfLineItems != null ? Number(totals.numberOfLineItems) : null,
      quantityHash: totals.hashTotal != null ? Number(totals.hashTotal) : null,
    },
  };
}
