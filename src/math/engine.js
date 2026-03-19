// ============================================================
// Debt Optimization System — Financial Math Engine
// Pure JS, no external dependencies, fully deterministic
// ============================================================

// ── 1. Amortization Schedule ─────────────────────────────────
/**
 * Generates full month-by-month amortization schedule for a loan.
 * Uses reducing balance method (standard for Indian term loans).
 *
 * @param {object} loan
 * @returns {Array<{
 *   month, date, openingBalance, emiPaid,
 *   principalComponent, interestComponent, closingBalance,
 *   cumulativeInterestPaid, cumulativePrincipalPaid
 * }>}
 */
export function generateAmortizationSchedule(loan) {
  const monthlyRate = loan.annualInterestRate / 100 / 12
  const emi = loan.emiAmount
  const applyGST = loan.gstOnInterest === true
  const gstRate = (loan.gstOnInterestRate ?? 18) / 100
  let balance = loan.principal
  let cumInterest = 0
  let cumPrincipal = 0
  let cumGST = 0

  const schedule = []
  const startDate = new Date(loan.firstEmiDate)

  for (let i = 1; i <= loan.tenureMonths; i++) {
    const interest = balance * monthlyRate
    let principal = emi - interest

    if (i === loan.tenureMonths || principal >= balance) {
      principal = balance
    }

    const closing = Math.max(0, balance - principal)
    const gstAmount = applyGST ? interest * gstRate : 0
    const totalOutflow = emi + gstAmount

    cumInterest += interest
    cumPrincipal += principal
    cumGST += gstAmount

    const d = new Date(startDate)
    d.setMonth(d.getMonth() + (i - 1))

    schedule.push({
      month: i,
      date: d.toISOString().slice(0, 10),
      openingBalance: round2(balance),
      emiPaid: round2(principal === balance ? interest + principal : emi),
      principalComponent: round2(principal),
      interestComponent: round2(interest),
      gstOnInterest: round2(gstAmount),
      totalMonthlyOutflow: round2(totalOutflow),
      closingBalance: round2(closing),
      cumulativeInterestPaid: round2(cumInterest),
      cumulativePrincipalPaid: round2(cumPrincipal),
      cumulativeGSTPaid: round2(cumGST),
    })

    balance = closing
    if (balance < 0.5) break
  }

  return schedule
}

// ── 2. Current Loan State ────────────────────────────────────
/**
 * Calculates where a loan stands today based on its schedule.
 * Treats any row whose date <= today as already paid.
 *
 * @param {object} loan
 * @returns {{
 *   emisPaid, emisRemaining, outstanding,
 *   interestPaid, principalPaid,
 *   interestRemaining, principalRemaining,
 *   nextEmiDate, progressPct,
 *   monthsElapsed, isCompleted
 * }}
 */
export function getCurrentLoanState(loan) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const schedule = generateAmortizationSchedule(loan);
  let emisPaid = 0;
  let interestPaid = 0;
  let principalPaid = 0;
  let outstanding = loan.principal;
  let interestRemaining = 0;
  let nextEmiDate = null;

  for (const row of schedule) {
    const rowDate = new Date(row.date);
    if (rowDate <= today) {
      emisPaid++;
      interestPaid += row.interestComponent;
      principalPaid += row.principalComponent;
      outstanding = row.closingBalance;
    } else {
      if (!nextEmiDate) nextEmiDate = row.date;
      interestRemaining += row.interestComponent;
    }
  }

  const emisRemaining = loan.tenureMonths - emisPaid;
  const progressPct = loan.principal > 0
    ? Math.min(100, round2((principalPaid / loan.principal) * 100))
    : 0;

  return {
    emisPaid,
    emisRemaining,
    outstanding: round2(outstanding),
    interestPaid: round2(interestPaid),
    principalPaid: round2(principalPaid),
    interestRemaining: round2(interestRemaining),
    principalRemaining: round2(outstanding),
    nextEmiDate,
    progressPct,
    monthsElapsed: emisPaid,
    isCompleted: outstanding < 1,
  };
}

// ── 3. True Cost + Effective APR ─────────────────────────────
/**
 * Calculates the total true cost of a loan including all fees,
 * and approximates the effective APR using IRR (Newton-Raphson).
 *
 * @param {object} loan
 * @returns {{
 *   totalAmountPaid, totalInterestPaid, totalFees,
 *   effectiveAPR, statedRate, rateDiff
 * }}
 */
export function calculateTrueCost(loan) {
  const schedule = generateAmortizationSchedule(loan)
  const totalEmisPaid = schedule.reduce((s, r) => s + r.emiPaid, 0)
  const totalGST = schedule.reduce((s, r) => s + (r.gstOnInterest ?? 0), 0)

  const totalFees =
    (loan.fees?.processingFee ?? 0) +
    (loan.fees?.processingFeeGST ?? 0) +
    (loan.fees?.insuranceCharges ?? 0) +
    (loan.fees?.otherCharges ?? []).reduce((s, c) => s + (c.amount ?? 0), 0)

  const totalAmountPaid = totalEmisPaid + totalFees + totalGST
  const totalInterestPaid = schedule.reduce((s, r) => s + r.interestComponent, 0)

  const netDisbursed = loan.principal - totalFees
  const cashflows = [-netDisbursed, ...schedule.map((r) => r.totalMonthlyOutflow)]
  const monthlyIRR = computeIRR(cashflows)
  const effectiveAPR = monthlyIRR !== null ? round2(monthlyIRR * 12 * 100) : null

  return {
    totalAmountPaid: round2(totalAmountPaid),
    totalInterestPaid: round2(totalInterestPaid),
    totalGSTPaid: round2(totalGST),
    totalFees: round2(totalFees),
    effectiveAPR,
    statedRate: loan.annualInterestRate,
    rateDiff: effectiveAPR !== null ? round2(effectiveAPR - loan.annualInterestRate) : null,
  }
}

// ── 4. Prepayment Savings ────────────────────────────────────
/**
 * Simulates making an extra lump-sum payment in a given month.
 * Recalculates remaining schedule with reduced principal.
 *
 * @param {object} loan
 * @param {number} extraAmount   - lump sum prepayment amount (₹)
 * @param {number} fromMonth     - 1-based month number when prepayment is made
 * @returns {{
 *   feasible, reason,
 *   newTenureMonths, monthsSaved,
 *   interestSaved, prepaymentCharge,
 *   netSavings, newOutstandingAfterPrepay
 * }}
 */
export function calculatePrepaymentSavings(loan, extraAmount, fromMonth) {
  // Check lock-in
  if (loan.prepayment?.allowed === false) {
    return { feasible: false, reason: "Prepayment not allowed for this loan." };
  }
  if (loan.prepayment?.lockInMonths > 0 && fromMonth <= loan.prepayment.lockInMonths) {
    return {
      feasible: false,
      reason: `Lock-in period active until month ${loan.prepayment.lockInMonths}. Prepayment not allowed yet.`,
    };
  }
  if (loan.prepayment?.minimumAmount > 0 && extraAmount < loan.prepayment.minimumAmount) {
    return {
      feasible: false,
      reason: `Minimum prepayment amount is ₹${fmt(loan.prepayment.minimumAmount)}.`,
    };
  }

  // Get outstanding at fromMonth
  const schedule = generateAmortizationSchedule(loan);
  const rowAtMonth = schedule[fromMonth - 1];
  if (!rowAtMonth) return { feasible: false, reason: "Month out of range." };

  const outstandingAtMonth = rowAtMonth.openingBalance;
  const prepayAmount = Math.min(extraAmount, outstandingAtMonth);

  // Prepayment charge
  let prepayCharge = 0;
  if (loan.prepayment?.chargePercent > 0) {
    prepayCharge = (prepayAmount * loan.prepayment.chargePercent) / 100;
  } else if (loan.prepayment?.chargeFlatAmount > 0) {
    prepayCharge = loan.prepayment.chargeFlatAmount;
  }

  // Original interest from fromMonth onwards
  const originalInterestRemaining = schedule
    .slice(fromMonth - 1)
    .reduce((s, r) => s + r.interestComponent, 0);

  // New outstanding after prepayment
  const newOutstanding = outstandingAtMonth - prepayAmount;
  if (newOutstanding < 1) {
    // Full prepayment — treated as foreclosure
    return {
      feasible: true,
      fullPayoff: true,
      newTenureMonths: fromMonth,
      monthsSaved: loan.tenureMonths - fromMonth,
      interestSaved: round2(originalInterestRemaining),
      prepaymentCharge: round2(prepayCharge),
      netSavings: round2(originalInterestRemaining - prepayCharge),
      newOutstandingAfterPrepay: 0,
    };
  }

  // Build new schedule from reduced outstanding (same EMI, shorter tenure)
  const newLoan = {
    ...loan,
    principal: newOutstanding,
    firstEmiDate: rowAtMonth.date,
  };
  const newSchedule = generateAmortizationSchedule(newLoan);
  const newInterestRemaining = newSchedule.reduce((s, r) => s + r.interestComponent, 0);
  const interestSaved = originalInterestRemaining - newInterestRemaining;

  return {
    feasible: true,
    fullPayoff: false,
    newTenureMonths: fromMonth + newSchedule.length - 1,
    monthsSaved: (loan.tenureMonths - fromMonth + 1) - newSchedule.length,
    interestSaved: round2(interestSaved),
    prepaymentCharge: round2(prepayCharge),
    netSavings: round2(interestSaved - prepayCharge),
    newOutstandingAfterPrepay: round2(newOutstanding),
  };
}

// ── 5. Foreclosure Savings ───────────────────────────────────
/**
 * Calculates the financial impact of foreclosing a loan in a given month.
 *
 * @param {object} loan
 * @param {number} inMonth  - 1-based month to foreclose
 * @returns {{
 *   feasible, reason,
 *   outstandingAtMonth, foreclosureCharge,
 *   totalPayout, interestSaved, netSavings,
 *   isWorthIt, breakEvenMonth
 * }}
 */
export function calculateForeclosureSavings(loan, inMonth) {
  if (loan.foreclosure?.allowed === false) {
    return { feasible: false, reason: "Foreclosure not allowed for this loan." };
  }
  if (loan.foreclosure?.lockInMonths > 0 && inMonth <= loan.foreclosure.lockInMonths) {
    return {
      feasible: false,
      reason: `Foreclosure lock-in active until month ${loan.foreclosure.lockInMonths}.`,
    };
  }

  const schedule = generateAmortizationSchedule(loan);
  const rowAtMonth = schedule[inMonth - 1];
  if (!rowAtMonth) return { feasible: false, reason: "Month out of range." };

  const outstanding = rowAtMonth.openingBalance;

  // Foreclosure charge
  let fcCharge = 0;
  if (loan.foreclosure?.chargePercent > 0) {
    fcCharge = (outstanding * loan.foreclosure.chargePercent) / 100;
  } else if (loan.foreclosure?.chargeFlatAmount > 0) {
    fcCharge = loan.foreclosure.chargeFlatAmount;
  }

  const totalPayout = outstanding + fcCharge;
  const interestRemaining = schedule
    .slice(inMonth - 1)
    .reduce((s, r) => s + r.interestComponent, 0);
  const netSavings = interestRemaining - fcCharge;
  const isWorthIt = netSavings > 0;

  // Break-even month: first month where interest saved > foreclosure charge
  let breakEvenMonth = null;
  for (let m = (loan.foreclosure?.lockInMonths ?? 0) + 1; m <= loan.tenureMonths; m++) {
    const r = schedule[m - 1];
    if (!r) break;
    const intRem = schedule.slice(m - 1).reduce((s, x) => s + x.interestComponent, 0);
    let fc = 0;
    if (loan.foreclosure?.chargePercent > 0) {
      fc = (r.openingBalance * loan.foreclosure.chargePercent) / 100;
    } else if (loan.foreclosure?.chargeFlatAmount > 0) {
      fc = loan.foreclosure.chargeFlatAmount;
    }
    if (intRem > fc) {
      breakEvenMonth = m;
      break;
    }
  }

  return {
    feasible: true,
    outstandingAtMonth: round2(outstanding),
    foreclosureCharge: round2(fcCharge),
    totalPayout: round2(totalPayout),
    interestSaved: round2(interestRemaining),
    netSavings: round2(netSavings),
    isWorthIt,
    breakEvenMonth,
  };
}

// ── 6. Rank Loans by Priority ────────────────────────────────
/**
 * Ranks all loans by effective APR (true cost including fees).
 * Higher APR = pay off first (avalanche method).
 *
 * @param {Array} loans
 * @returns {Array<{ loan, trueCost, rank, reason }>}
 */
export function rankLoansByPriority(loans) {
  return loans
    .map((loan) => {
      const tc = calculateTrueCost(loan);
      return { loan, trueCost: tc, effectiveAPR: tc.effectiveAPR ?? loan.annualInterestRate };
    })
    .sort((a, b) => b.effectiveAPR - a.effectiveAPR)
    .map((item, idx) => ({
      ...item,
      rank: idx + 1,
      reason:
        idx === 0
          ? "Highest effective cost — prioritise closing this first."
          : `Rank #${idx + 1} by effective APR (${item.effectiveAPR}%)`,
    }));
}

// ── 7. Allocate Surplus ──────────────────────────────────────
/**
 * Given a surplus amount, calculates optimal allocation across loans
 * to maximise interest saved (greedy by effective APR).
 *
 * @param {Array} loans
 * @param {number} surplusAmount
 * @returns {Array<{ loan, allocatedAmount, interestSaved, netSavings, prepaymentCharge }>}
 */
export function allocateSurplus(loans, surplusAmount) {
  const ranked = rankLoansByPriority(loans);
  let remaining = surplusAmount;
  const allocations = [];

  for (const { loan } of ranked) {
    if (remaining <= 0) break;
    const state = getCurrentLoanState(loan);
    if (state.isCompleted) continue;

    // How much can be prepaid on this loan?
    const minPrepay = loan.prepayment?.minimumAmount ?? 0;
    if (loan.prepayment?.allowed === false) continue;

    const allocate = Math.min(remaining, state.outstanding);
    if (allocate < minPrepay && minPrepay > 0) continue; // can't meet minimum

    const fromMonth = state.emisPaid + 1;
    const sim = calculatePrepaymentSavings(loan, allocate, fromMonth);

    if (sim.feasible) {
      allocations.push({
        loan,
        allocatedAmount: round2(allocate),
        interestSaved: sim.interestSaved,
        netSavings: sim.netSavings,
        prepaymentCharge: sim.prepaymentCharge,
      });
      remaining -= allocate;
    }
  }

  return allocations;
}

// ── Internal helpers ─────────────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fmt(n) {
  return Math.round(n).toLocaleString("en-IN");
}

/**
 * Newton-Raphson IRR solver for monthly cashflows.
 * cashflows[0] is the initial outflow (negative), rest are inflows.
 * Returns monthly rate, or null if it doesn't converge.
 */
function computeIRR(cashflows, guess = 0.01, maxIter = 100, tol = 1e-7) {
  let rate = guess;
  for (let iter = 0; iter < maxIter; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const cf = cashflows[t];
      const denom = Math.pow(1 + rate, t);
      npv += cf / denom;
      dnpv += (-t * cf) / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(dnpv) < 1e-12) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
  }
  return null;
}