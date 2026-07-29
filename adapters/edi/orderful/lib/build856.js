// Builds an Orderful 856 (Ship Notice/ASN) transaction message from a
// canonical Shipment. Schema confirmed live against Orderful's API — see
// docs/orderful-outbound-schema-notes.md for the full discovery record.
let controlNumber = 0;
const nextControlNumber = () => String(++controlNumber).padStart(4, '0');

function shipToN1Loop(shipment) {
  return [
    {
      partyIdentification: [
        {
          entityIdentifierCode: 'ST',
          name: shipment.customerName ?? undefined,
          identificationCodeQualifier: '92',
          identificationCode: shipment.customerId,
        },
      ],
    },
  ];
}

export function build856(shipment, { shipDate = new Date(), poNumber, routing } = {}) {
  const ctrl = nextControlNumber();
  const dateStr = shipDate.toISOString().slice(0, 10).replace(/-/g, '');

  const hlLoop = [
    {
      hierarchicalLevel: [{ hierarchicalLevelCode: 'S' }],
      N1_loop: shipToN1Loop(shipment),
      ...(routing ? { carrierDetailsRoutingSequenceTransitTime: [{ routing }] } : {}),
      dateTimeReference: [{ dateTimeQualifier: '011', date: dateStr }], // 011 = Shipped date
    },
    {
      hierarchicalLevel: [{ hierarchicalLevelCode: 'O' }],
      ...(poNumber ? { referenceInformation: [{ referenceIdentificationQualifier: 'IA', referenceIdentification: poNumber }] } : {}),
    },
  ];

  // One "P" (pack/carton) level per box, carrying its UCC/SSCC via
  // marksAndNumbersInformation, with each box's items nested at "I".
  for (const carton of shipment.cartons) {
    hlLoop.push({
      hierarchicalLevel: [{ hierarchicalLevelCode: 'P' }],
      ...(carton.ucc
        ? { marksAndNumbersInformation: [{ marksAndNumbersQualifier: 'GM', marksAndNumbers: carton.ucc }] }
        : {}),
    });
    for (const item of carton.items) {
      hlLoop.push({
        hierarchicalLevel: [{ hierarchicalLevelCode: 'I' }],
        itemIdentification: [
          { productServiceIDQualifier: 'VN', productServiceID: String(item.productId) },
        ],
        itemDetailShipment: [
          { numberOfUnitsShipped: String(item.qty), unitOrBasisForMeasurementCode: 'EA' },
        ],
      });
    }
  }

  return {
    transactionSetHeader: [
      { transactionSetIdentifierCode: '856', transactionSetControlNumber: ctrl },
    ],
    beginningSegmentForShipNotice: [
      {
        transactionSetPurposeCode: '00',
        shipmentIdentification: String(shipment.shipmentId),
        date: dateStr,
        time: shipDate.toISOString().slice(11, 16).replace(':', ''),
        hierarchicalStructureCode: '0001',
      },
    ],
    HL_loop: hlLoop,
  };
}
