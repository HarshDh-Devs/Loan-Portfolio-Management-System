# [Showcase] I Built an AI-Powered Command Center to Manage the Chaos of Loans and Credit Cards

## The Problem: Financial Fragmentation

Managing personal finance today has become a **"fragmentation" problem.**

1. **Loans are "Black Boxes":** You have a sanction letter, but you don't actually know your Effective APR or if a foreclosure is mathematically worth it.
2. **Credit Cards are "Chaos":** You have 5+ cards to maximize rewards, but you're losing track of due dates, annual fee waiver targets, and constant devaluations.

Most people end up using three different banking apps and a messy spreadsheet just to stay afloat.

---

## The Solution: SmartDebt

I built **SmartDebt** to be a unified intelligence platform that treats your debt and credit like a math problem to be solved.

---

## Key Features

### 🏦 For Your Loans (The Optimization Engine)

- 📄 **AI-Powered PDF Parsing:** Drop your Sanction Letter/KFS, and the app uses Groq AI to automatically extract all terms, penalties, and interest structures.
- ⚖️ **Smart Simulators:** Instantly calculate the impact of prepayments or foreclosures. The app identifies your **"Break-Even Month"** so you know exactly when closing a loan early becomes profitable.
- 🧮 **True Cost Analysis:** We calculate your real interest rate (Effective APR) including GST and hidden fees, revealing what you are *actually* paying.

### 💳 For Your Credit Cards (The Intelligence Hub)

- 💳 **Consolidated Card Manager:** A single view for all your card bills and due dates. No more hunting through SMS or emails to find what's due.
- 🎯 **Fee & Waiver Tracker:** Track your Annual Fee months and your Spend Targets for fee waivers in real-time.
- 🕵️ **Reddit-Driven Insights:** The app scrapes discussions from communities like r/CreditCardIndia to give you instant alerts on card devaluations, reward changes, or limited-time offers.

### 📊 For Your Overall Financial Health

- 📉 **The "Avalanche" Strategy:** The app ranks your entire portfolio (Loans + Cards) by effective interest rate and suggests exactly where to put your extra cash to save the most interest.
- 📱 **Privacy-First Sync:** Built with React 19 and Supabase (PostgreSQL). Your data is secured with Row-Level Security and syncs in real-time across all your devices.

---

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Tailwind CSS |
| Backend/DB | Supabase (PostgreSQL) |
| AI Engine | Groq (Llama-3) + PDF.js |
| Intelligence | Reddit Public API |

---

## 🔗 Check It Out

**Live App:** [loanfolio.vercel.app](https://loanfolio.vercel.app/)

---

I'd love to hear your thoughts! If you're managing multiple cards or a long-term loan, **what's the one feature that would make your life easier?**
