// canonical PickTicket -> 940 Warehouse Shipping Order X12.
// Segment layout confirmed against DCG's real sample (dcg-specs/sample-940.txt)
// and field meanings from dcg-specs/vida-mapping-940-945.txt -- a much
// messier, VIDA-legacy doc than 888's: several fields are retailer-specific
// extensions not documented at all (e.g. N9|F7, N9|OH in the real sample),
// and several others are marked "we wouldn't send this anymore" yet still
// appear in the real sample. Only fields with clear canonical-PickTicket
// support are implemented here -- see adapters/edi/x12-dcg/schema-notes.md
// for the full field-by-field reasoning and every field deliberately left out.
import { segment, buildEnvelope } from './envelope.js';
import { vendorItemNumber } from './itemCode.js';

function ccyymmdd(isoDate) {
  return isoDate ? isoDate.replace(/-/g, '') : null;
}

function buildW05(pickTicket, { transactionTypeCode }) {
  return segment('W05', 'N', pickTicket.pickTicketId ?? '', pickTicket.customerPo ?? '', '', '', transactionTypeCode);
}

function buildN1BT({ customerName, customerNumber }) {
  const elements = ['N1', 'BT', customerName ?? ''];
  if (customerNumber) elements.push('92', customerNumber);
  return segment(...elements);
}

function buildShipToLoop(shipTo) {
  const segs = [segment('N1', 'ST', shipTo?.name ?? '')];
  if (shipTo?.address1) segs.push(segment('N3', shipTo.address1, shipTo.address2 ?? ''));
  if (shipTo?.city) segs.push(segment('N4', shipTo.city ?? '', shipTo.state ?? '', shipTo.zip ?? '', shipTo.country ?? ''));
  return segs;
}

function buildOrderN9(pickTicket) {
  // Only the M3 Customer Order Number (CO) has a clear canonical source.
  // Skipped: N9|12 (small parcel account), N9|DP (dept number), N9|CR
  // (consumer order #), and retailer-specific extensions like N9|F7/N9|OH
  // seen in the real sample with no documented meaning at all.
  return pickTicket.orderId ? [segment('N9', 'CO', pickTicket.orderId)] : [];
}

function buildG62(pickTicket) {
  // EARLIEST_SHIP_DATE (10) <- pickTicket.date, CANCEL_SHIP_DATE (01) <-
  // pickTicket.dateDue. The real sample also sends an undocumented
  // qualifier '04' with no clear meaning in either the mapping doc or
  // canonical PickTicket -- deliberately omitted rather than guessed.
  const segs = [];
  const earliest = ccyymmdd(pickTicket.date);
  if (earliest) segs.push(segment('G62', '10', earliest));
  const cancel = ccyymmdd(pickTicket.dateDue);
  if (cancel) segs.push(segment('G62', '01', cancel));
  return segs;
}

function buildW66({ paymentMethod, carrierCode }) {
  return segment('W66', paymentMethod, 'M', '', '', carrierCode ?? '');
}

function buildLineSegments(line, index) {
  const segs = [
    segment('LX', String(index + 1)),
    segment(
      'W01',
      String(line.qty ?? ''),
      'EA',
      line.upc ?? '',                                               // UPC -- sourced from Inventory via parsePickTicket.js's skusById lookup; blank if AM has no UPC for this SKU
      'VN',
      vendorItemNumber(line.styleNumber, line.color, line.size),
      '', '', 'EA',
    ),
    segment('G69', line.description ?? ''),
  ];
  // N9|DV (per-line brand/division) and N9|RT (retail price) are in the real
  // sample but have no canonical-PickTicket source (no group/category or
  // distinct retail-price field on a line) -- omitted rather than guessed.
  if (line.styleNumber) segs.push(segment('N9', 'IS', line.styleNumber, line.description ?? ''));
  if (line.size) segs.push(segment('N9', 'IZ', line.size));
  // N9|VC carries color code + full color name, matching 888's VC pattern --
  // colorName now comes from Inventory via parsePickTicket.js.
  if (line.color) segs.push(segment('N9', 'VC', line.color, line.colorName ?? ''));
  return segs;
}

/**
 * @param {object} pickTicket - canonical PickTicket (core/canonical-objects.md)
 * @param {object} options
 * @param {string} [options.customerName] - N1|BT name; no canonical source (PickTicket.customerId is an ID, not a name) -- must be supplied by the caller, e.g. a separate AM customer lookup
 * @param {string} [options.customerNumber] - N1|BT id (N104), if available
 * @param {'42'|'10'|'13'} [options.transactionTypeCode] - W0506; default '42' (Customer Order) -- all Customer Order sub-flavors (DS / Direct-to-Store-DC / Mark-for-Store) share code 42 per VIDA's mapping, only Distribution (10) / Rework (13) differ, so 42 is a well-supported default for SCL's retail dropship model
 * @param {string} [options.paymentMethod] - W66; default 'PP' (prepaid), matches DCG's real sample
 * @param {Date} [options.date] - single timestamp for the ISA/GS envelope headers
 * @param {object} options.envelope - passed through to buildEnvelope: senderId, receiverId,
 *   interchangeControlNumber, groupControlNumber, transactionSetControlNumber, usageIndicator
 * @returns {string} the complete X12 940 file
 */
export function build940(pickTicket, options = {}) {
  const {
    customerName,
    customerNumber,
    transactionTypeCode = '42',
    paymentMethod = 'PP',
    date = new Date(),
    envelope = {},
  } = options;

  const body = [
    buildW05(pickTicket, { transactionTypeCode }),
    buildN1BT({ customerName, customerNumber }),
    ...buildShipToLoop(pickTicket.shipTo),
    ...buildOrderN9(pickTicket),
    ...buildG62(pickTicket),
    buildW66({ paymentMethod, carrierCode: pickTicket.shipVia }),
  ];

  (pickTicket.lines ?? []).forEach((line, index) => {
    body.push(...buildLineSegments(line, index));
  });

  body.push(segment('W76', String(pickTicket.qty ?? '')));

  return buildEnvelope(
    {
      functionalIdentifierCode: 'OW',
      transactionSetIdentifierCode: '940',
      ...envelope,
      date,
    },
    body,
  );
}
