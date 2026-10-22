// ZIMRA fiscalisation adapter (FDMS virtual fiscal device). Interface only until
// ZIMRA software approval and test credentials are obtained (issue #4, Wave 2);
// the fake lets the POS and invoices be built against it now.

export interface FiscalReceiptLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxCode: "standard" | "zero_rated" | "exempt";
  taxRateBp: number;
  totalCents: number;
}

export interface FiscalReceipt {
  companyId: string;
  deviceId: string;
  documentNumber: string;
  currency: "USD" | "ZWG" | "ZAR";
  issuedAt: Date;
  lines: FiscalReceiptLine[];
  totalCents: number;
  taxCents: number;
  buyerTaxNumber?: string;
}

export interface FiscalResult {
  fiscalNumber: string;
  /** Text to encode in the receipt's verification QR code. */
  qrData: string;
  /** True when queued offline and still to be submitted. */
  pending: boolean;
}

export interface FiscalDevice {
  readonly name: string;
  openDay(companyId: string, deviceId: string): Promise<{ dayNumber: number }>;
  submitReceipt(receipt: FiscalReceipt): Promise<FiscalResult>;
  closeDay(companyId: string, deviceId: string): Promise<{ dayNumber: number; receipts: number }>;
}

export class FakeFiscalDevice implements FiscalDevice {
  readonly name = "fake";
  private day = 0;
  private receipts = 0;
  readonly submitted: FiscalReceipt[] = [];

  async openDay() {
    this.day += 1;
    this.receipts = 0;
    return { dayNumber: this.day };
  }

  async submitReceipt(receipt: FiscalReceipt) {
    if (this.day === 0) throw new Error("open a fiscal day first");
    this.receipts += 1;
    this.submitted.push(receipt);
    const fiscalNumber = `TEST-${this.day}-${this.receipts}`;
    return { fiscalNumber, qrData: `https://fdms.test/verify/${fiscalNumber}`, pending: false };
  }

  async closeDay() {
    return { dayNumber: this.day, receipts: this.receipts };
  }
}
