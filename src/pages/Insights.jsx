import { useState, useEffect } from 'react'
import { getLoans } from '../data/hybridStorage'
import { getCurrentLoanState, calculateTrueCost } from '../math/engine'
import Navbar from '../components/Navbar'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'

async function callGroq(systemPrompt, userPrompt, maxTokens = 1500) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.choices[0].message.content
}

// ─── Pre-compute everything in JS ─────────────────────────────────────────────

function buildAnalysis(loans) {
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN')

  const all = loans.map(loan => {
    const state = getCurrentLoanState(loan)
    const tc = calculateTrueCost(loan)

    const monthlyInterest = Math.round(state.outstanding * (loan.annualInterestRate / 100) / 12)
    const totalFees = Math.round(
      (loan.fees?.processingFee || 0) +
      (loan.fees?.processingFeeGST || 0) +
      (loan.fees?.insuranceCharges || 0)
    )
    const feeRateImpact = Number((tc.effectiveAPR - loan.annualInterestRate).toFixed(2))
    const canForeclose = loan.foreclosure?.allowed || false
    const foreclosureCharge = canForeclose
      ? Math.round(state.outstanding * (loan.foreclosure.chargePercent || 0) / 100) + (loan.foreclosure.chargeFlatAmount || 0)
      : null
    const netSavings = foreclosureCharge !== null
      ? Math.round(state.interestRemaining - foreclosureCharge)
      : null
    const penaltyRecoveryMonths = (foreclosureCharge && monthlyInterest > 0)
      ? (foreclosureCharge / monthlyInterest).toFixed(1)
      : null
    const isActive = state.emisRemaining > 0 && state.interestRemaining > 100
    const efficiencyScore =
      penaltyRecoveryMonths
        ? (netSavings / Number(penaltyRecoveryMonths)) + monthlyInterest
        : monthlyInterest

    return {
      id: loan.id,
      name: loan.nickname,
      type: loan.type,
      isActive,
      statedRate: loan.annualInterestRate,
      effectiveAPR: tc.effectiveAPR,
      feeRateImpact,
      outstanding: Math.round(state.outstanding),
      interestRemaining: Math.round(state.interestRemaining),
      monthlyInterest,
      emisRemaining: state.emisRemaining,
      totalFees,
      canForeclose,
      foreclosureCharge,
      totalPayoutToday: foreclosureCharge !== null ? Math.round(state.outstanding + foreclosureCharge) : null,
      netSavings,
      efficiencyScore,
      penaltyRecoveryMonths,
      gstOnInterest: loan.gstOnInterest || false,
      totalGSTRemaining: loan.gstOnInterest ? Math.round(state.interestRemaining * 0.18) : 0,
    }
  })

  const active = all.filter(l => l.isActive)
  const settled = all.filter(l => !l.isActive)

  const totalOutstanding = all.reduce((s, l) => s + l.outstanding, 0)
  const totalMonthlyInterest = active.reduce((s, l) => s + l.monthlyInterest, 0)
  const totalInterestRemaining = active.reduce((s, l) => s + l.interestRemaining, 0)

  const closeCandidates = active
    .filter(l => l.canForeclose && l.netSavings !== null && l.netSavings > 0)
    .sort((a, b) => b.efficiencyScore - a.efficiencyScore)

  const bestToClose = closeCandidates[0] || null
  const highestMonthlyInterest = [...active].sort((a, b) => b.monthlyInterest - a.monthlyInterest)[0] || null
  const highestFeeImpact = [...active].sort((a, b) => b.feeRateImpact - a.feeRateImpact)[0] || null

  const rankBlock = closeCandidates.length > 0
    ? closeCandidates.map((l, i) =>
        `${i + 1}. ${l.name} — net savings: ${fmt(l.netSavings)} | monthly interest: ${fmt(l.monthlyInterest)} | closure cost: ${fmt(l.foreclosureCharge)} | recovery: ${l.penaltyRecoveryMonths} months`
      ).join('\n')
    : 'No foreclosure-eligible active loans.'

  const activeBlock = active.map(l => [
    `LOAN: ${l.name}`,
    `- Rate: ${l.statedRate}% stated | ${l.effectiveAPR}% effective APR | Fee impact: +${l.feeRateImpact}% | Fees paid: ${fmt(l.totalFees)}`,
    `- Outstanding: ${fmt(l.outstanding)} | EMIs remaining: ${l.emisRemaining}`,
    `- Monthly interest charge: ${fmt(l.monthlyInterest)}`,
    `- Total interest remaining: ${fmt(l.interestRemaining)}`,
    l.gstOnInterest ? `- GST on interest remaining: ${fmt(l.totalGSTRemaining)}` : null,
    `- Foreclosure: ${l.canForeclose
      ? `Yes — closure cost ${fmt(l.foreclosureCharge)}, payout today ${fmt(l.totalPayoutToday)}, net savings ${fmt(l.netSavings)}, recovery ${l.penaltyRecoveryMonths} months`
      : 'Not allowed'}`,
  ].filter(Boolean).join('\n')).join('\n\n')

  const settledBlock = settled.length > 0
    ? `LOANS WITH NO ACTIVE INTEREST (exclude from all recommendations):\n${settled.map(l => `- ${l.name}: ${fmt(l.outstanding)} remaining, ${l.emisRemaining} EMIs — no interest accruing`).join('\n')}`
    : ''

  return {
    all, active, settled,
    bestToClose, highestMonthlyInterest, highestFeeImpact, closeCandidates,
    totalOutstanding, totalMonthlyInterest, totalInterestRemaining,
    activeBlock, settledBlock, rankBlock, fmt,
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal finance advisor for an Indian borrower.
... (unchanged continues exactly as before)
`