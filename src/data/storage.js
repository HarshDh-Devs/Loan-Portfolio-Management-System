// ============================================================
// Debt Optimization System — Data Model & localStorage Utils
// ============================================================

// ── Default / empty loan template ───────────────────────────
export function createLoanTemplate() {
  return {
    id: crypto.randomUUID(),
    nickname: "",
    type: "Personal",           // Personal | Home | Car | Education | Credit Card | BNPL
    lender: "",
    accountNumber: "",

    // Core financials
    principal: 0,               // Original disbursed amount (₹)
    annualInterestRate: 0,      // % per annum
    tenureMonths: 0,
    emiAmount: 0,
    disbursementDate: "",       // ISO date string "YYYY-MM-DD"
    firstEmiDate: "",           // ISO date string "YYYY-MM-DD"

    // Upfront fees
    fees: {
  processingFee: 0,
  processingFeeGST: 0,
  insuranceCharges: 0,
  otherCharges: [],
},
gstOnInterest: false,      // true only for credit card loans
gstOnInterestRate: 18,     // % — standard 18% GST

    // Prepayment terms
    prepayment: {
      allowed: null,            // true | false | null (not sure)
      chargePercent: 0,         // % of prepaid amount
      chargeFlatAmount: 0,      // flat ₹ (use whichever is non-zero)
      minimumAmount: 0,
      lockInMonths: 0,
    },

    // Foreclosure terms
    foreclosure: {
      allowed: null,            // true | false | null (not sure)
      chargePercent: 0,         // % of outstanding
      chargeFlatAmount: 0,      // flat ₹
      lockInMonths: 0,
    },

    createdAt: new Date().toISOString(),
    monthlySnapshots: [],       // reserved for future manual overrides
  };
}

// ── Loan types ───────────────────────────────────────────────
export const LOAN_TYPES = [
  "Personal",
  "Home",
  "Car",
  "Education",
  "Credit Card",
  "BNPL",
];

// ── Storage keys ─────────────────────────────────────────────
const KEYS = {
  LOANS: "dos_loans",
  SETTINGS: "dos_settings",
};

// ── Settings model ───────────────────────────────────────────
export function defaultSettings() {
  return {
    groqApiKey: "",
    currency: "INR",
    theme: "light",
  };
}

// ── CRUD helpers ─────────────────────────────────────────────

/** Return all loans from storage (sorted by createdAt desc) */
export function getLoans() {
  try {
    const raw = localStorage.getItem(KEYS.LOANS);
    if (!raw) return [];
    const loans = JSON.parse(raw);
    return Array.isArray(loans) ? loans : [];
  } catch {
    return [];
  }
}

/** Persist full loans array */
function saveLoans(loans) {
  localStorage.setItem(KEYS.LOANS, JSON.stringify(loans));
}

/** Add a new loan. Returns the saved loan object. */
export function addLoan(loan) {
  const loans = getLoans();
  const toSave = { ...createLoanTemplate(), ...loan, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  loans.push(toSave);
  saveLoans(loans);
  return toSave;
}

/** Update an existing loan by id. Returns updated loan or null. */
export function updateLoan(id, updates) {
  const loans = getLoans();
  const idx = loans.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  loans[idx] = { ...loans[idx], ...updates };
  saveLoans(loans);
  return loans[idx];
}

/** Delete a loan by id. Returns true if deleted. */
export function deleteLoan(id) {
  const loans = getLoans();
  const filtered = loans.filter((l) => l.id !== id);
  if (filtered.length === loans.length) return false;
  saveLoans(filtered);
  return true;
}

/** Get a single loan by id. */
export function getLoanById(id) {
  return getLoans().find((l) => l.id === id) ?? null;
}

// ── Settings helpers ─────────────────────────────────────────

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEYS.SETTINGS);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(updates) {
  const current = getSettings();
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify({ ...current, ...updates }));
}

// ── Dev helpers (call from browser console) ──────────────────

export function seedMockData() {
  const mocks = [
    {
      nickname: "Example Loan 1",
      type: "Personal",
      lender: "HDFC Bank",
      principal: 500000,
      annualInterestRate: 10.5,
      tenureMonths: 48,
      emiAmount: 12834,
      disbursementDate: "2023-06-01",
      firstEmiDate: "2023-07-01",
      fees: { processingFee: 5000, processingFeeGST: 900, insuranceCharges: 0, otherCharges: [] },
      prepayment: { allowed: true, chargePercent: 2, chargeFlatAmount: 0, minimumAmount: 10000, lockInMonths: 6 },
      foreclosure: { allowed: true, chargePercent: 3, chargeFlatAmount: 0, lockInMonths: 6 },
    },
    {
      nickname: "Example Loan 2",
      type: "Home",
      lender: "SBI",
      principal: 3500000,
      annualInterestRate: 8.5,
      tenureMonths: 240,
      emiAmount: 30462,
      disbursementDate: "2021-03-01",
      firstEmiDate: "2021-04-01",
      fees: { processingFee: 15000, processingFeeGST: 2700, insuranceCharges: 25000, otherCharges: [] },
      prepayment: { allowed: true, chargePercent: 0, chargeFlatAmount: 0, minimumAmount: 0, lockInMonths: 0 },
      foreclosure: { allowed: true, chargePercent: 0, chargeFlatAmount: 0, lockInMonths: 0 },
    },
    {
      nickname: "Example Loan 3",
      type: "Car",
      lender: "Kotak Mahindra Bank",
      principal: 650000,
      annualInterestRate: 9.2,
      tenureMonths: 60,
      emiAmount: 13521,
      disbursementDate: "2022-09-01",
      firstEmiDate: "2022-10-01",
      fees: { processingFee: 3500, processingFeeGST: 630, insuranceCharges: 0, otherCharges: [] },
      prepayment: { allowed: true, chargePercent: 2.5, chargeFlatAmount: 0, minimumAmount: 5000, lockInMonths: 12 },
      foreclosure: { allowed: true, chargePercent: 4, chargeFlatAmount: 0, lockInMonths: 12 },
    },
  ];
  mocks.forEach(addLoan);
  console.log("DOS: 3 mock loans seeded.");
}

export function clearAllData() {
  localStorage.removeItem(KEYS.LOANS);
  localStorage.removeItem(KEYS.SETTINGS);
  console.log("DOS: all data cleared.");
}