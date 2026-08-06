// ISA/GS/ST ... SE/GE/IEA envelope framing for DCG's X12 flat files.
// Delimiters and control-number conventions verified byte-for-byte against
// DCG's real sample (dcg-specs/sample-888.txt): '|' element separator, '>'
// sub-element separator, newline segment terminator, ISA09 as 2-digit YYMMDD
// (GS04/G62 use 8-digit CCYYMMDD), ISA13/IEA02 zero-padded to 9 digits,
// GS06/GE02 unpadded, ISA06/ISA08 space-padded to 15 chars.
const ELEMENT_SEP = '|';
const SUB_ELEMENT_SEP = '>';
const SEGMENT_TERM = '\n';

export function segment(...elements) {
  return elements.map((e) => (e ?? '')).join(ELEMENT_SEP);
}

function pad15(value) {
  return String(value ?? '').padEnd(15, ' ').slice(0, 15);
}

function require(value, name) {
  if (value == null || value === '') throw new Error(`x12-dcg envelope: missing required field "${name}"`);
  return value;
}

export function buildEnvelope(
  {
    senderQualifier = 'ZZ',
    senderId,
    receiverQualifier = 'ZZ',
    receiverId,
    interchangeControlNumber,
    groupControlNumber,
    transactionSetControlNumber = '0001',
    functionalIdentifierCode,
    transactionSetIdentifierCode,
    responsibleAgencyCode = 'X',
    versionReleaseIndustryCode = '004010',
    interchangeControlVersion = '00401',
    usageIndicator = 'T', // 'T' = test, 'P' = production -- DCG's own sample used 'P'
    date = new Date(),
  },
  bodySegments,
) {
  require(senderId, 'senderId');
  require(receiverId, 'receiverId');
  require(interchangeControlNumber, 'interchangeControlNumber');
  require(groupControlNumber, 'groupControlNumber');
  require(functionalIdentifierCode, 'functionalIdentifierCode');
  require(transactionSetIdentifierCode, 'transactionSetIdentifierCode');

  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const isaDate = `${yy}${mm}${dd}`;
  const gsDate = `${date.getUTCFullYear()}${mm}${dd}`;
  const time = `${hh}${min}`;
  const isaControl = String(interchangeControlNumber).padStart(9, '0');

  const isa = segment(
    'ISA', '00', pad15(''), '00', pad15(''),
    senderQualifier, pad15(senderId), receiverQualifier, pad15(receiverId),
    isaDate, time, 'U', interchangeControlVersion, isaControl, '0', usageIndicator, SUB_ELEMENT_SEP,
  );

  const gs = segment(
    'GS', functionalIdentifierCode, senderId, receiverId,
    gsDate, time, String(groupControlNumber), responsibleAgencyCode, versionReleaseIndustryCode,
  );

  const st = segment('ST', transactionSetIdentifierCode, transactionSetControlNumber);

  // SE01 counts ST through SE inclusive -- confirmed against the real
  // sample (1193 body segments -> SE01 "1195" = body + ST + SE).
  const se = segment('SE', String(bodySegments.length + 2), transactionSetControlNumber);
  const ge = segment('GE', '1', String(groupControlNumber));
  const iea = segment('IEA', '1', isaControl);

  return [isa, gs, st, ...bodySegments, se, ge, iea].join(SEGMENT_TERM) + SEGMENT_TERM;
}

export { ELEMENT_SEP, SUB_ELEMENT_SEP, SEGMENT_TERM };
