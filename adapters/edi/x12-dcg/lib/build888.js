// canonical Item -> 888 Item Maintenance X12, one G39/G69/N9 block per SKU.
// Segment layout confirmed byte-for-byte against DCG's real sample
// (dcg-specs/sample-888.txt) and field meanings from
// dcg-specs/vida-mapping-888.txt. See adapters/edi/x12-dcg/schema-notes.md
// for the full mapping and the open questions flagged inline below.
import { segment, buildEnvelope } from './envelope.js';
import { vendorItemNumber } from './itemCode.js';

const num = (v) => (v == null ? '0.000' : Number(v).toFixed(3));

function buildN1({ vendorName, divisionCode }) {
  // DCG's own real sample has just "N1|VN|DCG" (2 elements, no N103/N104) --
  // ambiguous which name belongs here; using the configured vendor name.
  // See schema-notes.md.
  const elements = ['N1', 'VN', vendorName];
  if (divisionCode) elements.push('92', divisionCode);
  return segment(...elements);
}

function buildG62(date) {
  const ccyymmdd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return segment('G62', '7', ccyymmdd);
}

function buildG53(maintenanceType) {
  return segment('G53', maintenanceType);
}

function buildG39(item, sku) {
  return segment(
    'G39',
    sku.upc ?? '',
    'VN',
    vendorItemNumber(item.styleNumber, sku.color, sku.size),
    '',                                   // G3904 special handling code
    num(sku.weight ?? item.weight),       // G3905 unit weight
    'G',                                  // G3906 weight qualifier (gross -- matches DCG's real sample throughout)
    'L',                                  // G3907 weight unit (pounds)
    '0.000', 'IN',                        // G3908/09 height -- AM has no box-dimension data; DCG's own sample is 0.000 for every row too
    '0.000', 'IN',                        // G3910/11 width
    '0.000', 'IN',                        // G3912/13 length
    '1.000', 'CI',                        // G3914/15 volume -- one selling unit; AM has no case-pack data (see schema-notes.md, packQty is null)
    '',                                   // G3916 unmapped in DCG's spec, always blank in the sample
    item.packageConfig ?? '',             // G3917 package config <- AM package_config (per Aaron 2026-08-11)
    '1',                                  // G3918 unmapped, constant '1' in every row of DCG's sample
    (item.unitOfMeasure || 'EA').toUpperCase(), // G3919 unit of measure <- AM unit_of_measure (Ea/PR), default EA
    '', '', '',                           // G3920-22 unmapped in DCG's spec, always blank in the sample
    item.divisionId ?? '',                // G3923 division id <- AM division_id (per Aaron 2026-08-11)
    item.customerCode ?? '',              // G3924 customer <- AM att1_customer custom field (per Aaron 2026-08-11)
  );
}

function buildG69(item) {
  return segment('G69', item.description ?? '');
}

function buildN9Block(item, sku, { divisionCode }) {
  const blocks = [segment('N9', 'BO', sku.color ?? '')];
  // N9|DV (per-SKU brand/division code) -- present in every row of DCG's
  // real sample but its exact meaning for a non-VIDA vendor is unconfirmed;
  // only emitted if the caller supplies one. Confirm with Chi Cao whether
  // SCL needs this at all.
  if (divisionCode) blocks.push(segment('N9', 'DV', divisionCode));
  blocks.push(segment('N9', 'IT', item.styleNumber ?? ''));
  blocks.push(segment('N9', 'IZ', sku.size ?? ''));
  if (sku.color) blocks.push(segment('N9', 'VC', sku.color, sku.colorName ?? ''));
  return blocks;
}

/**
 * @param {object[]} items - canonical Item objects (core/canonical-objects.md)
 * @param {object} options
 * @param {string} options.vendorName - value for N102; confirm exact expected value with Chi Cao (see schema-notes.md)
 * @param {string} [options.divisionCode] - value for N9|DV / N1 N104, if DCG requires one for SCL
 * @param {'001'|'003'} [options.maintenanceType] - G53: '001' change, '003' add/full detail (default)
 * @param {Date} [options.date] - single timestamp used for both G62 (body) and the ISA/GS envelope headers
 * @param {object} options.envelope - passed through to buildEnvelope: senderId, receiverId,
 *   interchangeControlNumber, groupControlNumber, transactionSetControlNumber, usageIndicator
 *   (do not pass `envelope.date` separately -- use the top-level `date` option so body and envelope timestamps can't diverge)
 * @returns {string} the complete X12 888 file, ready to write to S3 / push via StartFileTransfer
 */
export function build888(items, options = {}) {
  const {
    vendorName,
    divisionCode,
    maintenanceType = '003',
    date = new Date(),
    envelope = {},
  } = options;

  const body = [
    buildN1({ vendorName, divisionCode }),
    buildG62(date),
    buildG53(maintenanceType),
  ];

  for (const item of items) {
    for (const sku of item.skus ?? []) {
      body.push(buildG39(item, sku));
      body.push(buildG69(item));
      body.push(...buildN9Block(item, sku, { divisionCode }));
    }
  }

  return buildEnvelope(
    {
      functionalIdentifierCode: 'QG',
      transactionSetIdentifierCode: '888',
      ...envelope,
      date, // always wins over envelope.date -- see options.date doc above
    },
    body,
  );
}
