// What the AI is asked to return, and the rules it follows.
// Every value comes with the page it was found on and an exact quote, so the
// app can show the source and check that the value really is in the document.

import { LOAN_TYPES } from '../../data/hybridStorage'

export const DOCUMENT_TYPES = [
  'kfs', 'sanction_letter', 'loan_agreement', 'repayment_schedule',
  'loan_statement', 'other_loan_document', 'not_a_loan_document',
]

export const FIELD_DEFS = {
  lender: { kind: 'string' },
  loanType: { kind: 'enum', values: [...LOAN_TYPES, 'Unknown'] },
  accountNumber: { kind: 'string' },
  principal: { kind: 'number' },
  netDisbursedAmount: { kind: 'number' },
  annualInterestRate: { kind: 'number' },
  rateBasis: { kind: 'enum', values: ['reducing', 'flat', 'unknown'] },
  interestType: { kind: 'enum', values: ['fixed', 'floating', 'unknown'] },
  tenureMonths: { kind: 'integer' },
  numberOfInstallments: { kind: 'integer' },
  emiAmount: { kind: 'number' },
  disbursementDate: { kind: 'date' },
  firstEmiDate: { kind: 'date' },
  apr: { kind: 'number' },
  processingFee: { kind: 'number' },
  processingFeeGST: { kind: 'number' },
  processingFeeIncludesGST: { kind: 'boolean' },
  insuranceCharges: { kind: 'number' },
  prepaymentAllowed: { kind: 'boolean' },
  prepaymentChargePercent: { kind: 'number' },
  prepaymentChargeFlat: { kind: 'number' },
  prepaymentMinAmount: { kind: 'number' },
  prepaymentLockInMonths: { kind: 'integer' },
  foreclosureAllowed: { kind: 'boolean' },
  foreclosureChargePercent: { kind: 'number' },
  foreclosureChargeFlat: { kind: 'number' },
  foreclosureLockInMonths: { kind: 'integer' },
}

const NULLABLE = {
  string: { type: ['string', 'null'] },
  number: { type: ['number', 'null'] },
  integer: { type: ['integer', 'null'] },
  boolean: { type: ['boolean', 'null'] },
  date: { type: ['string', 'null'] },
}

function fieldSchema(def) {
  const value = def.kind === 'enum' ? { type: 'string', enum: def.values } : NULLABLE[def.kind]
  return {
    type: 'object',
    properties: { value, page: { type: ['integer', 'null'] }, quote: { type: ['string', 'null'] } },
    required: ['value', 'page', 'quote'],
    additionalProperties: false,
  }
}

function strictObject(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

export const LOAN_SCHEMA = strictObject({
  documentType: { type: 'string', enum: DOCUMENT_TYPES },
  ...Object.fromEntries(Object.entries(FIELD_DEFS).map(([k, d]) => [k, fieldSchema(d)])),
  otherCharges: {
    type: 'array',
    items: strictObject({
      name: { type: 'string' },
      amount: { type: 'number' },
      page: { type: ['integer', 'null'] },
      quote: { type: ['string', 'null'] },
    }),
  },
  schedule: strictObject({
    found: { type: 'boolean' },
    page: { type: ['integer', 'null'] },
    firstDate: { type: ['string', 'null'] },
    firstOpeningBalance: { type: ['number', 'null'] },
    firstInterest: { type: ['number', 'null'] },
    firstPrincipal: { type: ['number', 'null'] },
    firstInstallment: { type: ['number', 'null'] },
    installmentCount: { type: ['integer', 'null'] },
  }),
  notes: { type: 'array', items: { type: 'string' } },
})

export const SYSTEM_PROMPT = `You read Indian loan documents (Key Fact Statements, sanction letters, loan agreements, repayment schedules) and copy the loan terms into JSON.

GOLDEN RULES
- Use only what is written in the document. Never guess, estimate or calculate a value. If a value is not written, set its value, page and quote to null (enums: "Unknown"/"unknown").
- For every value: "page" is the number N from the [Page N …] marker (or the page number given for an image), and "quote" is a short exact copy (at most about 100 characters) of the text that shows the value, copied character for character with the number as printed.
- Allowed conversions only: Indian number formats to plain numbers (5,00,000 → 500000; "5 lakh" → 500000; "1.2 crore" → 12000000); years to months for tenure and lock-in (3 years → 36); dates to YYYY-MM-DD.
- Dates in Indian documents are day-first: 05/06/2024 means 5 June 2024.
- Text in " | " separated rows comes from table cells on the same line.

FIELD RULES
- principal: the sanctioned / loan amount. Not the net disbursed amount, not the total amount payable.
- netDisbursedAmount: the amount paid out after deductions, only if stated.
- annualInterestRate: the yearly rate as written (10.50% p.a. → 10.5). Floating rate: the current total rate if stated (e.g. "repo 6.5% + spread 3% = 9.5%" → 9.5); if only the parts are given, null. A monthly rate alone → null.
- rateBasis: "flat" only if the document says flat rate; "reducing" if it says reducing/diminishing balance or has an amortization schedule; otherwise "unknown".
- interestType: "fixed" or "floating" as stated, else "unknown".
- emiAmount: the regular monthly instalment — not a broken-period/pre-EMI amount and not a total.
- tenureMonths: the loan tenure in months. numberOfInstallments: the number of EMIs, only if stated separately.
- firstEmiDate: due date of the first regular EMI. disbursementDate: the date the loan was or will be disbursed.
- processingFee: if fee and GST are shown separately, processingFee = fee without GST and processingFeeGST = the GST amount (processingFeeIncludesGST = false). If only one total "inclusive of GST" is shown, put that total in processingFee and set processingFeeIncludesGST = true.
- insuranceCharges: one-time insurance premium charged or financed with the loan.
- otherCharges: other one-time upfront charges in ₹ (stamp duty, documentation, login, CERSAI, valuation, legal…). Not penal, bounce, late-payment or per-EMI charges. Empty list if none.
- Prepayment = part-payment of some principal. Foreclosure = pre-closure / paying off the whole loan. Percentages without GST. "Nil" or "0%" → charge 0 and allowed = true. "Not allowed" → allowed = false. Lock-in = months from the start during which it is not allowed.
- apr: the Annual Percentage Rate, if stated.
- schedule: from a repayment / amortization table, if one is present: page, first row's due date, opening balance, interest, principal and instalment amounts, and installmentCount = the number of the last instalment row if visible. found = false and all nulls if there is no table.
- loanType: the closest type. EMI on a credit card → "Credit Card". Pay-later → "BNPL". "Unknown" if unclear.
- documentType: what this document is; "not_a_loan_document" if it is not about a loan.
- notes: up to 3 short warnings the borrower should know (for example "Rate is floating, linked to the repo rate"). Empty list if none.`

export function textUserMessage(documentText) {
  return `Copy the loan terms from this document into the JSON format.\n\nDOCUMENT:\n${documentText}`
}

export function visionUserText(pages) {
  const list = pages.map(p => `page ${p.id} (${p.fileName}${p.pageNo > 1 || p.fileName.toLowerCase().endsWith('.pdf') ? `, page ${p.pageNo}` : ''})`).join(' and ')
  return `The ${pages.length === 1 ? 'image is' : 'images are'} ${list} of the borrower's loan documents, in that order. Read them carefully, including small print and tables, and copy the loan terms into the JSON format. Use these page numbers in "page".`
}
