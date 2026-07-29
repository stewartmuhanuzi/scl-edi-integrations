// Builds an Orderful 810 (Invoice) transaction message from a canonical
// Invoice. Schema confirmed live against Orderful's API — see
// docs/orderful-outbound-schema-notes.md for the full discovery record.
let controlNumber = 0;
const nextControlNumber = () => String(++controlNumber).padStart(4, '0');

export function build810(invoice) {
  const ctrl = nextControlNumber();
  const dateStr = (invoice.invoiceDate || '').replace(/\D/g, '').slice(0, 8) || null;

  return {
    transactionSetHeader: [
      { transactionSetIdentifierCode: '810', transactionSetControlNumber: ctrl },
    ],
    beginningSegmentForInvoice: [
      {
        transactionSetPurposeCode: '00',
        invoiceNumber: String(invoice.invoiceId),
        date: dateStr,
      },
    ],
    N1_loop: [
      {
        partyIdentification: [
          {
            entityIdentifierCode: 'ST',
            name: invoice.shipTo.name ?? undefined,
            identificationCodeQualifier: '92',
            identificationCode: invoice.customerId,
          },
        ],
      },
      {
        partyIdentification: [
          {
            entityIdentifierCode: 'BT',
            identificationCodeQualifier: '92',
            identificationCode: invoice.customerId,
          },
        ],
      },
    ],
    IT1_loop: invoice.lines.map((line, i) => ({
      baselineItemDataInvoice: [
        {
          assignedIdentification: String(i + 1),
          quantityInvoiced: String(line.qty),
          unitOrBasisForMeasurementCode: 'EA',
          unitPrice: String(line.unitPrice),
          productServiceIDQualifier: 'SK',
          productServiceID: String(line.skuId),
        },
      ],
    })),
    totalMonetaryValueSummary: [{ amount: String(invoice.totals.total) }],
  };
}
