import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { getLoans } from '../data/hybridStorage'
import { getCurrentLoanState } from '../math/engine'
import {
  loadAllFinanceData, saveSettings,
  addCard, updateCard, deleteCard, reorderCards, patchFinanceData,
  addSubscription, updateSubscription, deleteSubscription,
  addExpense, updateExpense, deleteExpense
} from '../data/financeStorage'
import { formatINR, formatDateTime } from '../utils/format'
import {
  CARD_STATUS,
  MONTH_NAMES,
  cardRowClass,
  compareUpcomingDue,
  ensureCardSortOrder,
  formatDueCaption,
  getCardDueInfo,
  getFeeWaiverInfo,
  getUpcomingDueCycleKey,
  getUpcomingDueDate,
  monthKey,
  nextCardCycleUpdates,
  normalizeMonthKey,
} from '../utils/cardDue'
import { getCardBank, BANK_LIST } from '../utils/bankBrands'
import Navbar from '../components/Navbar'

const DASHBOARD_THEME_KEY = 'lpms_dashboard_dark'

function readDashboardDark() {
  try {
    return localStorage.getItem(DASHBOARD_THEME_KEY) === '1'
  } catch {
    return false
  }
}

export default function Dashboard({ session }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [isEditingBalance, setIsEditingBalance] = useState(false)
  const [balanceInput, setBalanceInput] = useState('')

  const [cards, setCards] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loans, setLoans] = useState([])
  const [loanSort, setLoanSort] = useState('none')
  const [cardSort, setCardSort] = useState('none')
  const [subscriptionSort, setSubscriptionSort] = useState('none')
  const [expenseSort, setExpenseSort] = useState('none')
  const [activeCardId, setActiveCardId] = useState(null)
  const [editingCard, setEditingCard] = useState(null)

  const [showModal, setShowModal] = useState(null) // 'card', 'subscription', 'emi', 'expense'

  // Credit Card Utilization aggregate
  const totalCreditLimit = cards.reduce((sum, c) => sum + (Number(c.credit_limit) || 0), 0)
  const totalCreditUsed = cards.reduce((sum, c) => sum + (c.paid ? 0 : (c.bill_amount || 0)), 0)
  const totalUtilization = totalCreditLimit > 0 ? Math.min(100, Math.round((totalCreditUsed / totalCreditLimit) * 100)) : null
  const [darkMode, setDarkMode] = useState(readDashboardDark)

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev
      try {
        localStorage.setItem(DASHBOARD_THEME_KEY, next ? '1' : '0')
      } catch {
        /* ignore quota / private mode */
      }
      return next
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  useEffect(() => {
    async function loadData() {
      try {
        // Single load — reads the blob once instead of 4 separate reads
        const [finData, l] = await Promise.all([
          loadAllFinanceData(session),
          getLoans(session)
        ])

        const { settings: s } = finData
        let { cards: cardsData, subscriptions: subsData, expenses: expsData } = finData

        const now = new Date()
        const currentMonthKey = monthKey(now)
        const lastReset = normalizeMonthKey(s.last_reset_month)
        const monthChanged = Boolean(lastReset && lastReset !== currentMonthKey)

        let cardsChanged = false

        // Calendar-month rollover is only for subscriptions/expenses.
        // Credit card bills follow each card's due day, not the 1st.
        if (monthChanged) {
          subsData = subsData.map(item => ({
            ...item,
            total_paid: (item.total_paid || 0) + (item.amount || 0)
          }))
          expsData = expsData.map(item => ({
            ...item,
            total_paid: (item.total_paid || 0) + (item.amount || 0)
          }))
        }

        // Auto-reset disabled — user manually controls paid/unpaid status

        const ordered = ensureCardSortOrder(cardsData)
        cardsData = ordered.cards
        if (ordered.changed) cardsChanged = true

        if (monthChanged || !lastReset || cardsChanged) {
          await patchFinanceData(session, (d) => {
            d.cards = cardsData
            d.subscriptions = subsData
            d.expenses = expsData
            d.settings = { ...(d.settings || {}), ...s, last_reset_month: currentMonthKey }
          })
        }

        setCards(cardsData)
        setSubscriptions(subsData)
        setExpenses(expsData)

        setBalance(s.available_balance || 0)
        setLoans(l)
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [session])

  const totalBills = [
    ...cards.filter(c => !c.paid).map(c => c.bill_amount || 0),
    ...subscriptions.filter(s => !s.paid).map(s => s.amount || 0),
    ...expenses.filter(e => !e.paid).map(e => e.amount || 0),
    ...loans.filter(l => l.type !== 'Credit Card').map(l => l.emiAmount || 0) // CC loans are excluded as they are part of the CC statement
  ].reduce((a, b) => a + b, 0)

  const creditCardBills = cards.filter(c => !c.paid).reduce((acc, c) => acc + (c.bill_amount || 0), 0)
  const loanEmis = loans.filter(l => l.type !== 'Credit Card').reduce((acc, l) => acc + (l.emiAmount || 0), 0)
  const otherExpenses = [
    ...subscriptions.filter(s => !s.paid).map(s => s.amount || 0),
    ...expenses.filter(e => !e.paid).map(e => e.amount || 0)
  ].reduce((a, b) => a + b, 0)

  const difference = balance - totalBills

  const sortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      if (cardSort === 'none') return (a.sort_order ?? 0) - (b.sort_order ?? 0)
      if (cardSort === 'due') return compareUpcomingDue(a, b)
      if (cardSort === 'amount_high') return (b.bill_amount || 0) - (a.bill_amount || 0)
      if (cardSort === 'amount_low') return (a.bill_amount || 0) - (b.bill_amount || 0)
      return 0
    })
  }, [cards, cardSort])

  const canDragCards = cardSort === 'none'
  const activeCard = activeCardId ? cards.find(c => c.id === activeCardId) : null

  const handleCardDragStart = (event) => {
    setActiveCardId(event.active.id)
  }

  const handleCardDragEnd = async (event) => {
    const { active, over } = event
    setActiveCardId(null)
    if (!over || active.id === over.id) return
    const ids = sortedCards.map(c => c.id)
    const oldIndex = ids.indexOf(active.id)
    const newIndex = ids.indexOf(over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(sortedCards, oldIndex, newIndex).map((c, i) => ({ ...c, sort_order: i }))
    setCards(reordered)
    await reorderCards(session, reordered.map(c => c.id))
  }

  const handleSaveEditedCard = async (data) => {
    if (!editingCard) return
    const updates = { ...data }
    if (updates.due_date) updates.bill_cycle = getUpcomingDueCycleKey(updates.due_date)
    await updateCard(session, editingCard.id, updates)
    setCards(prev => prev.map(c => c.id === editingCard.id ? { ...c, ...updates } : c))
    setEditingCard(null)
  }

  const handleSaveBalance = async () => {
    const newBalance = parseFloat(balanceInput) || 0
    await saveSettings(session, { available_balance: newBalance })
    setBalance(newBalance)
    setIsEditingBalance(false)
  }

  const togglePaid = async (type, item) => {
    const isPaid = !item.paid
    const updates = { paid: isPaid }

    if (isPaid) {
      updates.total_paid = (item.total_paid || 0) + (type === 'card' ? (item.bill_amount || 0) : (item.amount || 0))
      if (type === 'card') {
        updates.last_paid_amount = item.bill_amount || 0
        updates.last_paid_at = new Date().toISOString()
        // Record in payment history
        updates.payment_history = [
          ...(item.payment_history || []),
          { amount: item.bill_amount || 0, paid_at: new Date().toISOString() }
        ]
        updates.bill_amount = 0
        updates.settled_cycle = item.bill_cycle || getUpcomingDueCycleKey(item.due_date)
      } else {
        updates.amount = 0
      }
    } else {
      // Un-settling: remove the last payment entry (undo)
      if (type === 'card' && item.payment_history?.length) {
        const lastEntry = item.payment_history[item.payment_history.length - 1]
        updates.payment_history = item.payment_history.slice(0, -1)
        updates.total_paid = Math.max(0, (item.total_paid || 0) - (lastEntry.amount || 0))
      }
    }

    if (type === 'card') {
      await updateCard(session, item.id, updates)
      setCards(prev => prev.map(c => c.id === item.id ? { ...c, ...updates } : c))
    } else if (type === 'subscription') {
      await updateSubscription(session, item.id, updates)
      setSubscriptions(prev => prev.map(s => s.id === item.id ? { ...s, ...updates } : s))
    } else if (type === 'expense') {
      await updateExpense(session, item.id, updates)
      setExpenses(prev => prev.map(e => e.id === item.id ? { ...e, ...updates } : e))
    }
  }

  const handleDelete = async (type, id) => {
    if (!window.confirm('Delete this item?')) return
    if (type === 'card') {
      await deleteCard(session, id)
      setCards(prev => prev.filter(c => c.id !== id))
    } else if (type === 'subscription') {
      await deleteSubscription(session, id)
      setSubscriptions(prev => prev.filter(s => s.id !== id))
    } else if (type === 'expense') {
      await deleteExpense(session, id)
      setExpenses(prev => prev.filter(e => e.id !== id))
    }
  }

  const updateBillAmount = async (id, val) => {
    const amount = parseFloat(val) || 0
    const card = cards.find(c => c.id === id)
    const updates = { bill_amount: amount }
    if (card?.due_date) updates.bill_cycle = getUpcomingDueCycleKey(card.due_date)
    await updateCard(session, id, updates)
    setCards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  const updateTotalPaid = async (type, id, val) => {
    const amount = parseFloat(val) || 0
    const updates = { total_paid: amount }
    if (type === 'card') {
      await updateCard(session, id, updates)
      setCards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    } else if (type === 'subscription') {
      await updateSubscription(session, id, updates)
      setSubscriptions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    } else if (type === 'expense') {
      await updateExpense(session, id, updates)
      setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
    }
  }

  const updateDueDate = async (type, id, val) => {
    const day = parseInt(val) || null
    const updates = { due_date: day }
    if (type === 'card') {
      if (day) updates.bill_cycle = getUpcomingDueCycleKey(day)
      await updateCard(session, id, updates)
      setCards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    } else if (type === 'subscription') {
      await updateSubscription(session, id, updates)
      setSubscriptions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    } else if (type === 'expense') {
      await updateExpense(session, id, updates)
      setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
    }
  }

  const updateNotes = async (type, id, val) => {
    const updates = { notes: val }
    if (type === 'card') {
      await updateCard(session, id, updates)
      setCards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    } else if (type === 'subscription') {
      await updateSubscription(session, id, updates)
      setSubscriptions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    } else if (type === 'expense') {
      await updateExpense(session, id, updates)
      setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
    }
  }

  if (loading) {
    return (
      <div className={`dashboard-shell min-h-screen ${darkMode ? 'dashboard-shell--dark' : 'bg-gray-50'}`}>
        <Navbar session={session} activePage="Dashboard" darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className={`dashboard-shell min-h-screen pb-20 ${darkMode ? 'dashboard-shell--dark' : 'bg-gray-50'}`}>
      <Navbar session={session} activePage="Dashboard" darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />

      {/* Summary Bar */}
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

          {/* Main: Available Balance */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[85px] flex flex-col justify-start">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide leading-none">Available Balance</p>
              <p className="text-[9px] invisible leading-none mt-1">(alignment)</p>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xl font-semibold text-gray-900 leading-none">{formatINR(balance)}</span>
              <button
                onClick={() => {
                  setBalanceInput(balance.toString())
                  setIsEditingBalance(!isEditingBalance)
                }}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 leading-none"
              >
                Edit
              </button>
            </div>
            {isEditingBalance && (
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-gray-50"
                  placeholder="Amount"
                  autoFocus
                />
                <button
                  onClick={handleSaveBalance}
                  className="px-3 py-1 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 transition-all"
                >
                  Save
                </button>
              </div>
            )}
          </div>

          {/* Main: Total Bills */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[85px] flex flex-col justify-start">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide leading-none">Total Bills</p>
              <p className="text-[9px] invisible leading-none mt-1">(alignment)</p>
            </div>
            <span className="text-xl font-semibold text-gray-900 mt-1 leading-none">{formatINR(totalBills)}</span>
          </div>

          {/* Main: Net Balance */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[85px] flex flex-col justify-start">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide leading-none">Net Balance</p>
              <p className="text-[9px] invisible leading-none mt-1">(alignment)</p>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-xl font-semibold leading-none ${difference >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatINR(Math.abs(difference))}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-widest leading-none ${difference >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {difference >= 0 ? 'Surplus' : 'Deficit'}
              </span>
            </div>
          </div>

          {/* Breakdown: Credit Cards */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[85px] flex flex-col justify-start">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide leading-none">Credit Card Bills</p>
              <p className="text-[9px] invisible leading-none mt-1">(alignment)</p>
            </div>
            <span className="text-xl font-semibold text-gray-900 mt-1 leading-none">{formatINR(creditCardBills)}</span>
          </div>

          {/* Breakdown: Bank Loan EMIs */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[85px] flex flex-col justify-start">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide leading-none">Bank Loan EMIs</p>
              <p className="text-[9px] text-gray-400 lowercase leading-none mt-1">(Excluding CC EMIs)</p>
            </div>
            <span className="text-xl font-semibold text-gray-900 mt-1 leading-none">{formatINR(loanEmis)}</span>
          </div>

          {/* Breakdown: Subscriptions & Misc */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[85px] flex flex-col justify-start">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide leading-none">Subs & Misc</p>
              <p className="text-[9px] invisible leading-none mt-1">(alignment)</p>
            </div>
            <span className="text-xl font-semibold text-gray-900 mt-1 leading-none">{formatINR(otherExpenses)}</span>
          </div>

        </div>

        {/* Credit Utilization Bar (only if any card has credit_limit set) */}
        {totalCreditLimit > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total Credit Utilization</p>
              <span className={`text-xs font-bold uppercase tracking-widest ${
                totalUtilization <= 30 ? 'text-emerald-600' : totalUtilization <= 70 ? 'text-amber-600' : 'text-rose-600'
              }`}>
                {totalUtilization}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  totalUtilization <= 30 ? 'bg-emerald-500' : totalUtilization <= 70 ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${totalUtilization}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {formatINR(totalCreditUsed)} used of {formatINR(totalCreditLimit)} total limit across {cards.filter(c => c.credit_limit > 0).length} card{cards.filter(c => c.credit_limit > 0).length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">

        {/* Credit Cards Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-medium text-gray-400 uppercase tracking-widest">Credit Cards</h2>
              {canDragCards && cards.length > 1 && (
                <p className="text-[10px] text-slate-400 mt-1">Drag the handle to save your own order</p>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sort By</span>
                <select
                  value={cardSort}
                  onChange={(e) => setCardSort(e.target.value)}
                  className="text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 uppercase tracking-widest cursor-pointer outline-none hover:border-indigo-300 transition-all shadow-sm"
                >
                  <option value="due">Upcoming due</option>
                  <option value="none">Default (drag)</option>
                  <option value="amount_high">Bill Amount (High-Low)</option>
                  <option value="amount_low">Bill Amount (Low-High)</option>
                </select>
              </div>
              <button onClick={() => setShowModal('card')} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">+ Add Card</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {cards.length === 0 ? (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No credit cards added</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragStart={handleCardDragStart}
                onDragEnd={handleCardDragEnd}
                onDragCancel={() => setActiveCardId(null)}
              >
                <SortableContext items={sortedCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  {sortedCards.map(card => (
                    <SortableItemCard
                      key={card.id}
                      card={card}
                      disabled={!canDragCards}
                      onTogglePaid={() => togglePaid('card', card)}
                      onDelete={() => handleDelete('card', card.id)}
                      onUpdateBill={(val) => updateBillAmount(card.id, val)}
                      onUpdateTotalPaid={(val) => updateTotalPaid('card', card.id, val)}
                      onUpdateNotes={(val) => updateNotes('card', card.id, val)}
                      onUpdateDueDate={(val) => updateDueDate('card', card.id, val)}
                      onEdit={() => setEditingCard(card)}
                    />
                  ))}
                </SortableContext>
                <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
                  {activeCard ? (
                    <div className={`w-[min(920px,92vw)] shadow-2xl rounded-xl scale-[1.015] ring-1 ring-indigo-200 pointer-events-none ${darkMode ? 'dashboard-shell dashboard-shell--dark' : ''}`}>
                      <ItemCard
                        item={activeCard}
                        type="card"
                        isOverlay
                        onTogglePaid={() => {}}
                        onDelete={() => {}}
                        onUpdateBill={() => {}}
                        onUpdateTotalPaid={() => {}}
                        onUpdateNotes={() => {}}
                        onUpdateDueDate={() => {}}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </section>

        {/* EMIs & Loans Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-widest">EMIs & Loans</h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sort By</span>
                <select
                  value={loanSort}
                  onChange={(e) => setLoanSort(e.target.value)}
                  className="text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 uppercase tracking-widest cursor-pointer outline-none hover:border-indigo-300 transition-all shadow-sm"
                >
                  <option value="none">Default</option>
                  <option value="due">Upcoming due</option>
                  <option value="amount_high">Amount (High-Low)</option>
                  <option value="amount_low">Amount (Low-High)</option>
                  <option value="paid_most">Most Paid</option>
                  <option value="paid_least">Least Paid</option>
                </select>
              </div>
              <button
                onClick={() => navigate('/loans')}
                className="text-sm font-bold text-indigo-600 hover:text-indigo-700"
              >
                + Add Loan
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {[...loans]
              .map(l => ({ ...l, state: getCurrentLoanState(l) }))
              .sort((a, b) => {
                if (loanSort === 'due') {
                  const timeA = a.state.nextEmiDate ? new Date(a.state.nextEmiDate).getTime() : Infinity
                  const timeB = b.state.nextEmiDate ? new Date(b.state.nextEmiDate).getTime() : Infinity
                  return timeA - timeB
                }
                if (loanSort === 'amount_high') {
                  return (b.emiAmount || 0) - (a.emiAmount || 0)
                }
                if (loanSort === 'amount_low') {
                  return (a.emiAmount || 0) - (b.emiAmount || 0)
                }
                if (loanSort === 'paid_most') {
                  return b.state.emisPaid - a.state.emisPaid
                }
                if (loanSort === 'paid_least') {
                  return a.state.emisPaid - b.state.emisPaid
                }
                return 0
              })
              .map(loan => {
                const state = loan.state
                return (
                  <div key={loan.id} className="bg-white border border-gray-200 rounded-xl py-3 px-6 flex items-center gap-6 lg:gap-10 transition-all">
                    <div className="flex flex-col w-[220px] min-w-[180px] shrink-0">
                      <span className="text-sm font-medium text-gray-900 truncate">{loan.nickname}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Loan Profile</span>
                        {loan.type === 'Credit Card' && (
                          <span
                            className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0"
                            title="Billed directly inside your credit card statement; not counted twice in total bills"
                          >
                            Billed in CC
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 sm:gap-8 text-sm text-gray-500 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 uppercase tracking-wide min-w-[65px]">Next Due</span>
                        <span className="text-gray-700 font-medium">{getOrdinal(new Date(state.nextEmiDate).getDate())}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 uppercase tracking-wide min-w-[65px]">EMI Amt</span>
                        <span className="font-semibold text-gray-900">
                          {formatINR(Math.round(loan.emiAmount || 0))}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 uppercase tracking-wide min-w-[40px]">Term</span>
                        <span className="text-green-600 font-semibold">{state.emisPaid}/{loan.tenureMonths}</span>
                      </div>
                    </div>

                    <div className="flex-1 flex items-center gap-4 justify-end">
                      <button
                        onClick={() => navigate('/loans')}
                        className="text-[10px] font-bold text-slate-400 hover:text-indigo-500 uppercase tracking-widest transition-colors whitespace-nowrap"
                      >
                        Manage in Loans
                      </button>
                    </div>
                  </div>
                )
              })}
            {loans.length === 0 && (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No active loans found</p>
            )}
          </div>
        </section>

        {/* Subscriptions Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-widest">Subscriptions</h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sort By</span>
                <select
                  value={subscriptionSort}
                  onChange={(e) => setSubscriptionSort(e.target.value)}
                  className="text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 uppercase tracking-widest cursor-pointer outline-none hover:border-indigo-300 transition-all shadow-sm"
                >
                  <option value="none">Default</option>
                  <option value="due">Upcoming due</option>
                  <option value="amount_high">Amount (High-Low)</option>
                  <option value="amount_low">Amount (Low-High)</option>
                </select>
              </div>
              <button onClick={() => setShowModal('subscription')} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">+ Add Subscription</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {subscriptions.length === 0 ? (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No subscriptions added</p>
            ) : [...subscriptions]
              .sort((a, b) => {
                if (subscriptionSort === 'due') return compareUpcomingDue(a, b)
                if (subscriptionSort === 'amount_high') return (b.amount || 0) - (a.amount || 0)
                if (subscriptionSort === 'amount_low') return (a.amount || 0) - (b.amount || 0)
                return 0
              })
              .map(sub => (
                <ItemCard
                  key={sub.id}
                  item={sub}
                  type="subscription"
                  onTogglePaid={() => togglePaid('subscription', sub)}
                  onDelete={() => handleDelete('subscription', sub.id)}
                  onUpdateTotalPaid={(val) => updateTotalPaid('subscription', sub.id, val)}
                  onUpdateNotes={(val) => updateNotes('subscription', sub.id, val)}
                  onUpdateDueDate={(val) => updateDueDate('subscription', sub.id, val)}
                />
              ))}
          </div>
        </section>

        {/* Other Expenses Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-widest">Other Expenses</h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sort By</span>
                <select
                  value={expenseSort}
                  onChange={(e) => setExpenseSort(e.target.value)}
                  className="text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 uppercase tracking-widest cursor-pointer outline-none hover:border-indigo-300 transition-all shadow-sm"
                >
                  <option value="none">Default</option>
                  <option value="due">Upcoming due</option>
                  <option value="amount_high">Amount (High-Low)</option>
                  <option value="amount_low">Amount (Low-High)</option>
                </select>
              </div>
              <button onClick={() => setShowModal('expense')} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">+ Add Expense</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {expenses.length === 0 ? (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No expenses added</p>
            ) : [...expenses]
              .sort((a, b) => {
                if (expenseSort === 'due') return compareUpcomingDue(a, b)
                if (expenseSort === 'amount_high') return (b.amount || 0) - (a.amount || 0)
                if (expenseSort === 'amount_low') return (a.amount || 0) - (b.amount || 0)
                return 0
              })
              .map(exp => (
                <ItemCard
                  key={exp.id}
                  item={exp}
                  type="expense"
                  onTogglePaid={() => togglePaid('expense', exp)}
                  onDelete={() => handleDelete('expense', exp.id)}
                  onUpdateTotalPaid={(val) => updateTotalPaid('expense', exp.id, val)}
                  onUpdateNotes={(val) => updateNotes('expense', exp.id, val)}
                  onUpdateDueDate={(val) => updateDueDate('expense', exp.id, val)}
                />
              ))}
          </div>
        </section>

      </div>

      {/* Add Modal */}
      {showModal && (
        <AddModal
          type={showModal}
          onClose={() => setShowModal(null)}
          onAdd={async (data) => {
            if (showModal === 'card') {
              const res = await addCard(session, data)
              setCards(prev => [...prev, res])
            } else if (showModal === 'subscription') {
              const res = await addSubscription(session, data)
              setSubscriptions(prev => [...prev, res])
            } else if (showModal === 'expense') {
              const res = await addExpense(session, data)
              setExpenses(prev => [...prev, res])
            }
            setShowModal(null)
          }}
        />
      )}
      {editingCard && (
        <AddModal
          type="card"
          editItem={editingCard}
          onClose={() => setEditingCard(null)}
          onAdd={handleSaveEditedCard}
        />
      )}
    </div>
  )
}

function getOrdinal(n) {
  if (!n) return ''
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Financial Year helpers (Indian FY: April 1 → March 31) ──────────────────

function getFYKey(date) {
  const month = date.getMonth() // 0-indexed, Jan=0
  const year = date.getFullYear()
  const fyStartYear = month >= 3 ? year : year - 1
  return `${fyStartYear}-${fyStartYear + 1}`
}

function getFYLabel(key) {
  const [start, end] = key.split('-')
  return `FY ${start.slice(-2)}-${end.slice(-2)}`
}

function getCurrentFYKey() {
  return getFYKey(new Date())
}

// ── Spending Trend Chart (SVG bar chart from payment_history) ─────────────────

function SpendingTrend({ payments }) {
  const monthData = useMemo(() => {
    if (!payments?.length) return []

    // Group payments by month, last 12 months
    const now = new Date()
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-IN', { month: 'short' })
      months.push({ key, label, total: 0 })
    }

    const monthMap = Object.fromEntries(months.map(m => [m.key, m]))
    for (const p of payments) {
      if (!p.paid_at) continue
      const d = new Date(p.paid_at)
      if (isNaN(d)) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthMap[key]) monthMap[key].total += (p.amount || 0)
    }

    return months
  }, [payments])

  if (!payments?.length || monthData.length === 0) return null

  const maxVal = Math.max(...monthData.map(m => m.total), 1)
  const hasAnyData = monthData.some(m => m.total > 0)
  if (!hasAnyData) return null

  const barWidth = 20
  const gap = 6
  const chartHeight = 80
  const labelHeight = 18
  const svgWidth = monthData.length * (barWidth + gap)
  const svgHeight = chartHeight + labelHeight

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-3">Spending Trend (Last 12 Months)</p>
      <div className="overflow-x-auto pb-1">
        <svg width={svgWidth} height={svgHeight} className="block">
          {monthData.map((m, i) => {
            const barH = m.total > 0 ? Math.max(3, (m.total / maxVal) * (chartHeight - 16)) : 0
            const x = i * (barWidth + gap)
            const y = chartHeight - barH
            return (
              <g key={m.key}>
                {/* Bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barH}
                  rx={3}
                  className={m.total > 0 ? 'fill-indigo-400' : 'fill-slate-100'}
                />
                {/* Amount label above bar (only if > 0) */}
                {m.total > 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 3}
                    textAnchor="middle"
                    className="fill-slate-500"
                    style={{ fontSize: '8px', fontWeight: 600 }}
                  >
                    {m.total >= 1000 ? `${(m.total / 1000).toFixed(0)}k` : m.total}
                  </text>
                )}
                {/* Month label */}
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 12}
                  textAnchor="middle"
                  className="fill-slate-400"
                  style={{ fontSize: '8px', fontWeight: 600, textTransform: 'uppercase' }}
                >
                  {m.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── Payment History Component ────────────────────────────────────────────────

function PaymentHistory({ payments }) {
  const [selectedFY, setSelectedFY] = useState(null)

  // Build FY → payments map
  const { fyMap, fyKeys } = useMemo(() => {
    const map = {}
    for (const p of (payments || [])) {
      if (!p.paid_at) continue
      const d = new Date(p.paid_at)
      if (isNaN(d)) continue
      const fy = getFYKey(d)
      if (!map[fy]) map[fy] = []
      map[fy].push(p)
    }
    const keys = Object.keys(map).sort().reverse() // newest FY first
    return { fyMap: map, fyKeys: keys }
  }, [payments])

  const activeFY = selectedFY && fyMap[selectedFY] ? selectedFY : (fyKeys[0] || getCurrentFYKey())
  const fyPayments = fyMap[activeFY] || []

  // Group payments within selected FY by month (newest month first)
  const monthGroups = useMemo(() => {
    const groups = {}
    for (const p of fyPayments) {
      const d = new Date(p.paid_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      if (!groups[key]) groups[key] = { label, payments: [] }
      groups[key].payments.push(p)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, v]) => v)
  }, [fyPayments])

  const fyTotal = fyPayments.reduce((sum, p) => sum + (p.amount || 0), 0)

  if (!payments?.length) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Payment History</p>
        <p className="text-xs text-slate-400 italic">No payment history yet. Payments will appear here when you mark bills as paid.</p>
      </div>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Payment History</p>
        {fyKeys.length > 0 && (
          <select
            value={activeFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            className="text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 uppercase tracking-widest cursor-pointer outline-none hover:border-indigo-300 transition-all shadow-sm"
          >
            {fyKeys.map(fy => (
              <option key={fy} value={fy}>{getFYLabel(fy)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-3">
        {monthGroups.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No payments in {getFYLabel(activeFY)}</p>
        ) : monthGroups.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">{group.label}</p>
            <div className="space-y-1 pl-3 border-l-2 border-slate-100">
              {group.payments
                .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at))
                .map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-semibold text-slate-700">
                      <span className="text-slate-400 mr-0.5 font-sans font-normal">₹</span>
                      {(p.amount || 0).toLocaleString('en-IN')}
                    </span>
                    <span className="text-slate-400">—</span>
                    <span className="text-slate-500 text-xs">
                      {new Date(p.paid_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
                      })}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {getFYLabel(activeFY)} Total
        </span>
        <span className="text-sm font-bold text-slate-700">
          <span className="text-slate-400 mr-0.5 font-sans font-normal">₹</span>
          {fyTotal.toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  )
}

function SortableItemCard({ card, disabled, ...itemProps }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
    animateLayoutChanges: ({ isSorting, wasDragging }) => isSorting || wasDragging,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? undefined
      : (transition || 'transform 220ms cubic-bezier(0.2, 0, 0, 1)'),
    zIndex: isDragging ? 20 : undefined,
    position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-40' : 'transition-shadow duration-200'}>
      <ItemCard
        item={card}
        type="card"
        dragHandle={disabled ? null : { attributes, listeners }}
        {...itemProps}
      />
    </div>
  )
}

function ItemCard({ item, type, onTogglePaid, onDelete, onUpdateBill, onUpdateTotalPaid, onUpdateNotes, onUpdateDueDate, onEdit, dragHandle, isOverlay }) {
  const [showDetails, setShowDetails] = useState(false)
  const [isEditingTotalPaid, setIsEditingTotalPaid] = useState(false)
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [isEditingDueDate, setIsEditingDueDate] = useState(false)
  const amount = type === 'card' ? item.bill_amount : item.amount
  const isPaid = item.paid

  // Local state for the inputs to prevent typing lag
  const [localAmount, setLocalAmount] = useState(amount || '')
  const [localTotalPaid, setLocalTotalPaid] = useState(item.total_paid || 0)
  const [localNotes, setLocalNotes] = useState(item.notes || '')
  const [localDueDate, setLocalDueDate] = useState(item.due_date || '')
  const dueInfo = type === 'card' ? getCardDueInfo(item) : null
  const statusMeta = dueInfo ? CARD_STATUS[dueInfo.status] : null
  const feeInfo = type === 'card' ? getFeeWaiverInfo(item) : null
  const upcomingDue = item.due_date ? getUpcomingDueDate(item.due_date) : null

  // Credit limit utilization for this card
  const creditLimit = Number(item.credit_limit) || 0
  const creditUsed = type === 'card' && !item.paid ? (item.bill_amount || 0) : 0
  const utilPct = creditLimit > 0 ? Math.min(100, Math.round((creditUsed / creditLimit) * 100)) : null

  // Statement date info
  const statementDay = type === 'card' ? (Number(item.statement_date) || 0) : 0
  const bankMeta = type === 'card' ? getCardBank(item) : null
  const dueLabel = type === 'card'
    ? dueInfo.caption
    : (upcomingDue ? formatDueCaption(upcomingDue) : (item.due_date ? getOrdinal(item.due_date) : '—'))

  // Update local state if the parent amount changes
  useEffect(() => {
    setLocalAmount(amount || '')
    setLocalTotalPaid(item.total_paid || 0)
    setLocalNotes(item.notes || '')
    setLocalDueDate(item.due_date || '')
  }, [amount, item.total_paid, item.notes, item.due_date])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onUpdateBill(localAmount)
    }
  }

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-all ${
      type === 'card'
        ? `${cardRowClass(dueInfo.status)} ${bankMeta ? `border-l-4 ${bankMeta.borderLeft}` : ''}`
        : 'border-gray-200'
    }`}>
      <div className="py-3 px-4 sm:px-6 flex flex-wrap lg:flex-nowrap items-center gap-3 lg:gap-6">
        {dragHandle && (
          <button
            type="button"
            aria-label="Drag to reorder"
            className="shrink-0 cursor-grab active:cursor-grabbing touch-none p-1.5 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-50"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 5h2v2H9V5zm4 0h2v2h-2V5zM9 11h2v2H9v-2zm4 0h2v2h-2v-2zM9 17h2v2H9v-2zm4 0h2v2h-2v-2z" />
            </svg>
          </button>
        )}

        <div className="flex flex-col w-[200px] min-w-[160px] shrink-0">
          <span className="text-sm font-medium text-gray-900 truncate">{item.nickname}</span>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {type === 'card' && bankMeta && (
              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${bankMeta.badgeClass}`}>
                {bankMeta.name}
              </span>
            )}
            {type === 'card' && statusMeta && (
              <span className={`w-fit text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${statusMeta.className}`}>
                {statusMeta.label}
              </span>
            )}
          </div>
          {!isOverlay && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-[10px] font-bold text-slate-400 hover:text-indigo-500 flex items-center gap-1 mt-0.5 text-left transition-colors tracking-widest uppercase"
            >
              <span>{showDetails ? '▴ Hide Details' : '▾ Show Details'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-[200px] flex-1 lg:flex-none">
          <span className="text-xs text-gray-400 uppercase tracking-wide shrink-0">Due</span>
          {isEditingDueDate ? (
            <>
              <input
                type="number"
                min="1" max="31"
                value={localDueDate}
                onChange={(e) => setLocalDueDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onUpdateDueDate(localDueDate); setIsEditingDueDate(false) }
                  if (e.key === 'Escape') setIsEditingDueDate(false)
                }}
                autoFocus
                className="w-12 px-1.5 py-0.5 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-center"
              />
              <button
                onClick={() => { onUpdateDueDate(localDueDate); setIsEditingDueDate(false) }}
                className="text-[9px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest"
              >
                ✓
              </button>
              <button
                onClick={() => setIsEditingDueDate(false)}
                className="text-[9px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span className={`text-sm font-medium ${dueInfo?.status === 'overdue' ? 'text-rose-700' : 'text-gray-800'}`}>
                {dueLabel}
              </span>
              {!isOverlay && (
                <button
                  onClick={() => setIsEditingDueDate(true)}
                  title="Edit due day"
                  className="text-slate-300 hover:text-indigo-500 transition-colors ml-0.5"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536M9 11l6.364-6.364a2 2 0 112.828 2.828L11.828 13.828A2 2 0 0110 14.4V16h1.6a2 2 0 001.414-.586l.172-.172" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-[120px]">
          <span className="text-xs text-gray-400 uppercase tracking-wide">Amount</span>
          {isPaid ? (
            <span className="text-emerald-600 font-bold text-[10px] bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 tracking-widest uppercase">Paid</span>
          ) : (
            <span className="font-semibold text-gray-900">
              <span className="text-gray-400 mr-0.5 font-sans font-normal">₹</span>{(amount || 0).toLocaleString('en-IN')}
            </span>
          )}
        </div>

        {type === 'card' && isPaid && item.last_paid_at && (
          <div className="flex flex-col min-w-[160px] shrink-0">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Last paid</span>
            <span className="text-sm font-semibold text-gray-900">
              {formatINR(item.last_paid_amount || 0)}
            </span>
            <span className="text-[11px] text-slate-500">{formatDateTime(item.last_paid_at)}</span>
          </div>
        )}

        {feeInfo && (
          <div className="hidden xl:flex flex-col min-w-[150px] shrink-0">
            {feeInfo.feeHitsThisMonth && (
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                Fee {formatINR(feeInfo.feeAmount)} this month
              </span>
            )}
            {feeInfo.waiver > 0 && (
              <span className={`text-[10px] ${feeInfo.met ? 'text-emerald-600 font-semibold' : 'text-slate-500'}`}>
                {feeInfo.met ? 'Waiver target met' : `${formatINR(feeInfo.remaining)} left to waive`}
              </span>
            )}
          </div>
        )}

        {type === 'card' && utilPct !== null && (
          <div className="hidden lg:flex flex-col min-w-[100px] shrink-0">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Utilization</span>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden min-w-[60px]">
                <div
                  className={`h-full rounded-full ${utilPct <= 30 ? 'bg-emerald-500' : utilPct <= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
                  style={{ width: `${utilPct}%` }}
                />
              </div>
              <span className={`text-[10px] font-bold ${utilPct <= 30 ? 'text-emerald-600' : utilPct <= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
                {utilPct}%
              </span>
            </div>
          </div>
        )}

        {!isOverlay && (
        <div className="flex-1 flex items-center gap-4 justify-end">
          {type === 'card' && !isPaid && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={localAmount}
                onChange={(e) => setLocalAmount(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Set bill"
                className="w-24 px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50/30 transition-all"
              />
              {localAmount.toString() !== (amount || '').toString() && (
                <button
                  onClick={() => onUpdateBill(localAmount)}
                  className="text-[9px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest"
                >
                  Save
                </button>
              )}
            </div>
          )}

          {type === 'card' && (
            <button
              onClick={onTogglePaid}
              className={`px-5 py-1.5 text-[10px] font-bold rounded-full border transition-all shadow-sm tracking-widest uppercase ${isPaid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600 cursor-pointer hover:bg-emerald-100'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-500 hover:text-indigo-600 active:scale-95'
                }`}
            >
              {isPaid ? 'Settled ✓' : 'Mark Paid'}
            </button>
          )}

          <button
            onClick={onDelete}
            className="text-slate-400 hover:text-rose-600 transition-all p-1.5 rounded-lg hover:bg-rose-50 group/del"
            title="Delete Item"
          >
            <svg className="w-4 h-4 transition-transform group-hover/del:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        )}
      </div>

      {showDetails && (
        <div className="bg-slate-50/50 border-t border-slate-100 px-8 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Details</p>
            {type === 'card' && onEdit && (
              <button
                onClick={onEdit}
                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
              >
                Edit card
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3">
          {type === 'card' && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Full Card Name</p>
              <p className="text-sm font-semibold text-slate-700">{item.card_name || '—'}</p>
            </div>
          )}

          {type === 'card' && bankMeta && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Bank / Issuer</p>
              <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full inline-block ${bankMeta.borderLeft.replace('border-l-', 'bg-')}`} />
                {bankMeta.fullName}
              </p>
            </div>
          )}

          {type === 'card' && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Statement Date</p>
              <p className="text-sm font-semibold text-slate-700">
                {statementDay > 0 ? `${getOrdinal(statementDay)} of every month` : '—'}
              </p>
              {statementDay > 0 && item.due_date && (
                <p className="text-[10px] text-slate-400">
                  Statement → Due: ~{Math.abs(item.due_date - statementDay)} days gap
                </p>
              )}
            </div>
          )}

          {type === 'card' && creditLimit > 0 && (
            <div className="space-y-1 col-span-2">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Credit Limit & Utilization</p>
              <p className="text-sm font-semibold text-slate-700">
                {formatINR(creditUsed)} / {formatINR(creditLimit)}
                <span className={`ml-2 text-xs font-bold ${utilPct <= 30 ? 'text-emerald-600' : utilPct <= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
                  {utilPct}% used
                </span>
              </p>
              <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full rounded-full ${utilPct <= 30 ? 'bg-emerald-500' : utilPct <= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
                  style={{ width: `${utilPct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400">
                {utilPct <= 30 ? 'Healthy utilization — good for credit score' : utilPct <= 70 ? 'Moderate utilization' : 'High utilization — may impact credit score'}
              </p>
            </div>
          )}

          {type === 'card' && item.last_paid_at && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Last paid</p>
              <p className="text-sm font-semibold text-slate-700">{formatINR(item.last_paid_amount || 0)}</p>
              <p className="text-[11px] text-slate-500">{formatDateTime(item.last_paid_at)}</p>
            </div>
          )}

          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total Paid</p>
              <button
                onClick={() => setIsEditingTotalPaid(!isEditingTotalPaid)}
                className="text-[9px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-widest"
              >
                {isEditingTotalPaid ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {isEditingTotalPaid ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={localTotalPaid}
                  onChange={(e) => setLocalTotalPaid(e.target.value)}
                  className="w-24 px-2 py-0.5 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                />
                <button
                  onClick={() => {
                    onUpdateTotalPaid(localTotalPaid)
                    setIsEditingTotalPaid(false)
                  }}
                  className="text-[9px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest"
                >
                  Save
                </button>
              </div>
            ) : (
              <p className="text-sm font-mono font-semibold text-slate-700">{formatINR(item.total_paid || 0)}</p>
            )}
          </div>

          {type === 'card' && (
            <>
              <div className="space-y-0.5">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Annual Fee</p>
                <p className="text-sm font-semibold text-slate-700">
                  {item.annual_fee_type === 'LTF'
                    ? <span className="text-emerald-600">LTF</span>
                    : `${formatINR(item.annual_fee)} in ${item.fee_month || '—'}`
                  }
                </p>
                {feeInfo?.feeHitsThisMonth && (
                  <p className="text-[11px] font-medium text-amber-700">Fee hits this statement cycle</p>
                )}
              </div>
              {feeInfo && feeInfo.waiver > 0 && (
                <div className="space-y-1 col-span-2">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Waiver progress</p>
                  <p className="text-sm font-semibold text-slate-700">
                    {formatINR(feeInfo.spent)} / {formatINR(feeInfo.waiver)}
                    {feeInfo.met
                      ? <span className="ml-2 text-emerald-600 text-xs">Target met</span>
                      : <span className="ml-2 text-slate-500 text-xs">{formatINR(feeInfo.remaining)} left</span>}
                  </p>
                  <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${feeInfo.met ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                      style={{ width: `${feeInfo.pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {feeInfo.periodLabel
                      ? `Tracking period: ${feeInfo.periodLabel} (resets on anniversary)`
                      : 'Set a fee month to track anniversary-year spend automatically'}
                  </p>
                </div>
              )}
            </>
          )}

          <div className="space-y-0.5 col-span-2">
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Notes</p>
              <button
                onClick={() => setIsEditingNotes(!isEditingNotes)}
                className="text-[9px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-widest"
              >
                {isEditingNotes ? 'Cancel' : (item.notes ? 'Edit' : '+ Add Note')}
              </button>
            </div>
            {isEditingNotes ? (
              <div className="flex flex-col gap-2 mt-1">
                <textarea
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                  rows="2"
                  placeholder="Enter note..."
                />
                <button
                  onClick={() => {
                    onUpdateNotes(localNotes)
                    setIsEditingNotes(false)
                  }}
                  className="self-end px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 uppercase tracking-widest transition-all"
                >
                  Save
                </button>
              </div>
            ) : (
              item.notes ? (
                <p className="text-sm text-slate-600 italic">"{item.notes}"</p>
              ) : (
                <p className="text-xs text-slate-400 italic">No notes added</p>
              )
            )}
          </div>
          </div>

          {type === 'card' && (
            <SpendingTrend payments={item.payment_history} />
          )}

          {type === 'card' && (
            <PaymentHistory payments={item.payment_history} />
          )}
        </div>
      )}
    </div>
  )
}

function AddModal({ type, editItem, onClose, onAdd }) {
  const isEdit = Boolean(editItem)
  const [nickname, setNickname] = useState(editItem?.nickname || '')
  const [cardName, setCardName] = useState(editItem?.card_name || '')
  const [amount, setAmount] = useState(editItem?.amount ?? '')
  const [dueDate, setDueDate] = useState(editItem?.due_date || '')
  const [feeType, setFeeType] = useState(editItem?.annual_fee_type || 'LTF')
  const [annualFee, setAnnualFee] = useState(editItem?.annual_fee ?? '')
  const [feeMonth, setFeeMonth] = useState(editItem?.fee_month || '')
  const [waiverAmount, setWaiverAmount] = useState(editItem?.waiver_amount ?? '')
  const [notes, setNotes] = useState(editItem?.notes || '')
  const [creditLimit, setCreditLimit] = useState(editItem?.credit_limit ?? '')
  const [statementDate, setStatementDate] = useState(editItem?.statement_date || '')
  const [bank, setBank] = useState(editItem?.bank || '')

  const titles = {
    card: isEdit ? 'Edit Credit Card' : 'Add Credit Card',
    subscription: 'Add Subscription',
    expense: 'Add Expense'
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!nickname) return alert('Nickname is required')

    const data = {
      nickname,
      due_date: dueDate === '' || dueDate == null ? null : parseInt(dueDate, 10),
      notes: notes,
    }

    if (!isEdit) {
      data.paid = false
    }

    if (type === 'card') {
      data.card_name = cardName
      data.annual_fee_type = feeType
      data.annual_fee = feeType === 'paid' ? parseFloat(annualFee) : null
      data.fee_month = feeType === 'paid' ? feeMonth : null
      data.waiver_amount = feeType === 'paid' ? parseFloat(waiverAmount) : null
      data.credit_limit = parseFloat(creditLimit) || null
      data.statement_date = statementDate === '' || statementDate == null ? null : parseInt(statementDate, 10)
      data.bank = bank || null
      if (!isEdit) data.bill_amount = 0
    } else {
      data.amount = parseFloat(amount) || 0
    }

    onAdd(data)
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">{titles[type]}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Nickname</label>
            <input
              autoFocus
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              placeholder="e.g. Netflix, Rent, HDFC Card"
            />
          </div>

          {type === 'card' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Card Name</label>
              <input
                type="text"
                value={cardName}
                onChange={e => setCardName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                placeholder="e.g. HDFC Millennia"
              />
            </div>
          )}

          {type === 'card' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Bank / Issuer</label>
              <select
                value={bank}
                onChange={e => setBank(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm bg-white"
              >
                <option value="">Auto-detect from card name</option>
                {BANK_LIST.map(b => (
                  <option key={b.id} value={b.id}>{b.fullName} ({b.name})</option>
                ))}
              </select>
            </div>
          )}

          {type !== 'card' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Amount (₹)</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                placeholder="0.00"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Due Date (Day of Month)</label>
            <input
              type="number"
              min="1" max="31"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              placeholder="e.g. 15"
            />
          </div>

          {type === 'card' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Statement Date (Day of Month)</label>
              <input
                type="number"
                min="1" max="31"
                value={statementDate}
                onChange={e => setStatementDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                placeholder="e.g. 1"
              />
              <p className="text-[10px] text-slate-400">Day when your monthly statement is generated</p>
            </div>
          )}

          {type === 'card' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Credit Limit (₹)</label>
              <input
                type="number"
                value={creditLimit}
                onChange={e => setCreditLimit(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                placeholder="e.g. 200000"
              />
            </div>
          )}

          {type === 'card' && (
            <>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Annual Fee</label>
                <select
                  value={feeType}
                  onChange={e => setFeeType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                >
                  <option value="LTF">LTF (Lifetime Free)</option>
                  <option value="paid">Annual Fee Applicable</option>
                </select>
              </div>

              {feeType === 'paid' && (
                <div className="space-y-4 pt-2 border-t border-gray-100">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fee Amount (₹)</label>
                    <input
                      type="number"
                      value={annualFee}
                      onChange={e => setAnnualFee(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                      placeholder="e.g. 999"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fee Charged Month</label>
                    <select
                      value={feeMonth}
                      onChange={e => setFeeMonth(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                    >
                      <option value="">Select Month</option>
                      {MONTH_NAMES.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Waiver Amount Required (₹)</label>
                    <input
                      type="number"
                      value={waiverAmount}
                      onChange={e => setWaiverAmount(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                      placeholder="e.g. 100000"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              placeholder="Add a reminder or detail..."
              rows="2"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition-colors mt-6 text-xs uppercase tracking-widest"
          >
            {isEdit ? 'Save changes' : `Add ${type}`}
          </button>
        </form>
      </div>
    </div>
  )
}
