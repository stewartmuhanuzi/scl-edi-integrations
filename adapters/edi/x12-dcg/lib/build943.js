// canonical PurchaseOrder -> 943 Warehouse Shipment Advice X12 (DCG calls
// this "Inbound Purchase Order" / "Factory ASN" -- vendor stock SCL is
// telling DCG's warehouse to expect).
// Segment layout confirmed against DCG's real samples
// (dcg-specs/sample-943-simple.txt, dcg-specs/sample-943-with-cartons.txt)
// and field meanings from dcg-specs/vida-mapping-943-944.txt -- messier than
// even 940's mapping doc: several fields are marked "we wouldn't send this
// anymore" yet still appear in both real samples, and the per-line W04
// segment's trailing elements are genuinely inconsistent between the two
// samples (different vendor item number schemes, one has a trailing
// size-code pair the other doesn't). Only fields with clear canonical-
// PurchaseOrder support are implemented here -- see
// adapters/edi/x12-dcg/schema-notes.md for the full field-by-field
// reasoning and everything deliberately left out (including N9|GM, the
// same carton-SSCC segment already dropped from consideration on the 943
// per the DCG-specs review -- AM has no carton-level packing data).
import { segment, buildEnvelope } from './envelope.js';
import { vendorItemNumber } from './itemCode.js';

function ccyymmdd(isoDate) {
  return isoDate ? isoDate.replace(/-/g, '') : null;
}

function ccyymmddFromDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function buildW06(purchaseOrder, { transactionTypeCode, date }) {
  // W0602 and W0604 both carry the same order number in both real samples
  // (confirmed, not a transcription artifact) -- this is the correlation ID
  // DCG must send back on the 944 (W1704), per the architecture's
  // correlation-id design. W0603 mirrors the envelope's own GS04 date in
  // both samples, so it's derived from the same `date` option (a Date
  // object, unlike PurchaseOrder's own ISO-string date fields) rather than
  // a separate PurchaseOrder field.
  const orderNumber = purchaseOrder.purchaseOrderId ?? '';
  return segment(
    'W06', 'F', orderNumber, ccyymmddFromDate(date), orderNumber,
    '', '', '', '', '', '',
    transactionTypeCode,
  );
}

function buildWarehouseLoop(warehouseCode) {
  // N101=WH and PER01=WH both carry the same value in both real samples --
  // a DCG-side physical-location/warehouse code, per the mapping doc's own
  // note ("For DCG: Liz to communicate mapping of M3 WHLO to physical
  // locations in DCG system"). This is NOT AM's own internal warehouseId
  // (different systems, different code schemes) -- must be supplied
  // explicitly via options.warehouseCode until DCG confirms the real
  // value(s) to use. N1|LW (seen in one sample) is a Distribution-Order-
  // flavor field per the mapping doc, not applicable to the Factory-ASN
  // flavor this builder targets -- deliberately omitted.
  if (!warehouseCode) return [];
  return [segment('N1', 'WH', warehouseCode), segment('PER', 'WH', warehouseCode)];
}

function buildHeaderN9(purchaseOrder, { orderReference, brandDescription, brandCode }) {
  const segs = [];
  // N9|CH ("Customer" attribute) <- AM att1_customer, per DCG's mapping
  // (Mike, 2026-08-12). e.g. WALMSC, BURLING.
  if (purchaseOrder.customerCode) segs.push(segment('N9', 'CH', purchaseOrder.customerCode));
  // N9|CO ("Customer Order No") <- AM att2_sales_order, per the same mapping.
  // An explicit orderReference option overrides it when supplied.
  const co = orderReference ?? purchaseOrder.salesOrderRef;
  if (co) segs.push(segment('N9', 'CO', co));
  // N9|KK ("Delivery Reference/Method") maps reasonably to shipVia.
  if (purchaseOrder.shipVia) segs.push(segment('N9', 'KK', purchaseOrder.shipVia));
  // N9|SI ("Trailer/Container Number") maps to trackingNumber.
  if (purchaseOrder.trackingNumber) segs.push(segment('N9', 'SI', purchaseOrder.trackingNumber));
  return segs;
}

function buildG62(purchaseOrder) {
  const expected = ccyymmdd(purchaseOrder.dateDue);
  return expected ? [segment('G62', '17', expected)] : [];
}

function buildLineSegments(line, index, { brandDescription, brandCode }) {
  const lineNumber = String(index + 1).padStart(6, '0');
  const segs = [
    segment(
      'W04',
      String(line.qty ?? ''),
      'EA',
      '', // W0403 -- UPC, deliberately blank; DCG's own doc says "not sent anymore" and both real samples leave it blank
      'VN',
      vendorItemNumber(line.styleNumber, line.color, line.size),
      'IT',
      line.styleNumber ?? '',
      '', '', '',
      lineNumber,
    ),
  ];
  if (line.description) segs.push(segment('G69', line.description));
  // N9|DI/N9|DV (brand description/code) have no canonical per-line source
  // on PurchaseOrder -- same optional, caller-supplied pattern as 888's
  // N9|DV division code, emitted per line to match both real samples
  // (which show them immediately after each line's W04/G69).
  if (brandDescription) segs.push(segment('N9', 'DI', brandDescription));
  if (brandCode) segs.push(segment('N9', 'DV', brandCode));
  return segs;
}

/**
 * @param {object} purchaseOrder - canonical PurchaseOrder (core/canonical-objects.md)
 * @param {object} options
 * @param {string} [options.warehouseCode] - N1|WH and PER|WH; a DCG-side warehouse/location
 *   code, not AM's own warehouseId -- no canonical source, confirm the real value with Chi Cao
 * @param {string} [options.orderReference] - N9|CO; a second, distinct order-number field seen
 *   in DCG's real samples with no canonical PurchaseOrder equivalent -- omitted unless supplied
 * @param {string} [options.brandDescription] - N9|DI, per line; no canonical source
 * @param {string} [options.brandCode] - N9|DV, per line; no canonical source
 * @param {'PO'|'DO'|'RMA'} [options.transactionTypeCode] - W0611; default 'PO' (Factory ASN),
 *   the flavor that matches canonical PurchaseOrder (vendor stock arriving at DCG's warehouse) --
 *   confirmed present in DCG's real sample, not a guess, but worth an explicit check with Chi Cao
 * @param {Date} [options.date] - single timestamp for the ISA/GS envelope headers and W0603
 * @param {object} options.envelope - passed through to buildEnvelope: senderId, receiverId,
 *   interchangeControlNumber, groupControlNumber, transactionSetControlNumber, usageIndicator
 * @returns {string} the complete X12 943 file
 */
export function build943(purchaseOrder, options = {}) {
  const {
    warehouseCode,
    orderReference,
    brandDescription,
    brandCode,
    transactionTypeCode = 'PO',
    date = new Date(),
    envelope = {},
  } = options;

  const body = [
    buildW06(purchaseOrder, { transactionTypeCode, date }),
    ...buildWarehouseLoop(warehouseCode),
    ...buildHeaderN9(purchaseOrder, { orderReference, brandDescription, brandCode }),
    ...buildG62(purchaseOrder),
  ];

  (purchaseOrder.lines ?? []).forEach((line, index) => {
    body.push(...buildLineSegments(line, index, { brandDescription, brandCode }));
  });

  return buildEnvelope(
    {
      functionalIdentifierCode: 'AR',
      transactionSetIdentifierCode: '943',
      ...envelope,
      date,
    },
    body,
  );
}
