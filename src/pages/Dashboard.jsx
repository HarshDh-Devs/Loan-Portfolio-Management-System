import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLoans } from '../data/hybridStorage'
import { getCurrentLoanState } from '../math/engine'
import {
  getSettings, saveSettings,
  getCards, addCard, updateCard, deleteCard,
  getSubscriptions, addSubscription, updateSubscription, deleteSubscription,
  getManualEmis, addManualEmi, updateManualEmi, deleteManualEmi,
  getExpenses, addExpense, updateExpense, deleteExpense
} from '../data/financeStorage'
import { formatINR, formatNumber } from '../utils/format'
import Navbar from '../components/Navbar'

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

  const [showModal, setShowModal] = useState(null) // 'card', 'subscription', 'emi', 'expense'

  useEffect(() => {
    async function loadData() {
      try {
        const [s, c, sub, exp, l] = await Promise.all([
          getSettings(session),
          getCards(session),
          getSubscriptions(session),
          getExpenses(session),
          getLoans(session)
        ])

        // Automatic Monthly Reset Logic
        const now = new Date()
        const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`
        const lastReset = s.last_reset_month

        if (lastReset && lastReset !== currentMonthKey) {
          // It's a new month! Update total_paid for automatic items
          const updatedSubs = sub.map(item => ({
            ...item,
            total_paid: (item.total_paid || 0) + (item.amount || 0)
          }))
          const updatedExps = exp.map(item => ({
            ...item,
            total_paid: (item.total_paid || 0) + (item.amount || 0)
          }))
          const updatedCards = c.map(item => ({
            ...item,
            paid: false,
            bill_amount: 0
          }))

          // Save updates to DB
          await Promise.all([
            ...updatedSubs.map(item => updateSubscription(session, item.id, { total_paid: item.total_paid })),
            ...updatedExps.map(item => updateExpense(session, item.id, { total_paid: item.total_paid })),
            ...updatedCards.map(item => updateCard(session, item.id, { paid: false, bill_amount: 0 })),
            saveSettings(session, { ...s, last_reset_month: currentMonthKey })
          ])

          setSubscriptions(updatedSubs)
          setExpenses(updatedExps)
          setCards(updatedCards)
        } else {
          if (!lastReset) {
            // Initialize last_reset_month for new users
            await saveSettings(session, { ...s, last_reset_month: currentMonthKey })
          }
          setCards(c)
          setSubscriptions(sub)
          setExpenses(exp)
        }

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
    ...loans.map(l => l.emiAmount || 0) // Assuming loans are always "unpaid" in this view for now
  ].reduce((a, b) => a + b, 0)

  const difference = balance - totalBills

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
      // Reset amount to 0 when paid
      if (type === 'card') {
        updates.bill_amount = 0
      } else {
        // For other expenses, we might not want to reset the base amount, 
        // but the user asked to reset amount to 0.
        updates.amount = 0
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
    await updateCard(session, id, { bill_amount: amount })
    setCards(prev => prev.map(c => c.id === id ? { ...c, bill_amount: amount } : c))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar session={session} activePage="Dashboard" />
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Navbar session={session} activePage="Dashboard" />

      {/* Summary Bar */}
      <div className="bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100/50 transition-all hover:shadow-md hover:bg-white">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Available Balance</p>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-slate-800 tracking-tight">{formatINR(balance)}</span>
                <button 
                  onClick={() => {
                    setBalanceInput(balance.toString())
                    setIsEditingBalance(!isEditingBalance)
                  }}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-wider"
                >
                  Edit
                </button>
              </div>
              {isEditingBalance && (
                <div className="mt-4 flex gap-2">
                  <input 
                    type="number" 
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    placeholder="Enter amount"
                  />
                  <button 
                    onClick={handleSaveBalance}
                    className="px-4 py-2 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 uppercase tracking-widest transition-all shadow-lg shadow-indigo-200"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100/50 transition-all hover:shadow-md hover:bg-white">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Total Bills</p>
              <span className="text-3xl font-bold text-slate-800 tracking-tight">{formatINR(totalBills)}</span>
            </div>

            <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100/50 transition-all hover:shadow-md hover:bg-white">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Difference</p>
              <div className="flex flex-col">
                <span className={`text-3xl font-bold tracking-tight ${difference >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {formatINR(Math.abs(difference))}
                </span>
                <span className={`text-[10px] font-bold mt-1 tracking-widest ${difference >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {difference >= 0 ? 'SURPLUS' : 'DEFICIT'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">

        {/* Credit Cards Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em]">Credit Cards</h2>
            <button onClick={() => setShowModal('card')} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">+ Add Card</button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {cards.length === 0 ? (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No credit cards added</p>
            ) : cards.map(card => (
              <ItemCard
                key={card.id}
                item={card}
                type="card"
                onTogglePaid={() => togglePaid('card', card)}
                onDelete={() => handleDelete('card', card.id)}
                onUpdateBill={(val) => updateBillAmount(card.id, val)}
              />
            ))}
          </div>
        </section>

        {/* EMIs & Loans Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em]">EMIs & Loans</h2>
            <button
              onClick={() => navigate('/loans')}
              className="text-sm font-bold text-indigo-600 hover:text-indigo-700"
            >
              + Add Loan
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {loans.map(loan => {
              const state = getCurrentLoanState(loan)
              return (
                <div key={loan.id} className="bg-white border border-slate-100 rounded-2xl py-4 px-6 flex items-center gap-12 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all duration-300 group">
                  <div className="flex flex-col w-[240px] shrink-0">
                    <span className="text-lg font-semibold text-slate-800 truncate tracking-tight leading-tight group-hover:text-indigo-600 transition-colors">{loan.nickname}</span>
                    <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-1">Loan Profile</span>
                  </div>

                  <div className="grid grid-cols-[120px_160px_100px] gap-4 text-base text-slate-500 font-medium shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest min-w-[65px]">Next Due</span>
                      <span className="text-slate-700 font-semibold">{getOrdinal(new Date(state.nextEmiDate).getDate())}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest min-w-[65px]">EMI Amt</span>
                      <span className="font-mono font-bold text-lg text-slate-800">
                        <span className="text-indigo-600/60 mr-0.5 font-sans">₹</span>{(loan.emiAmount || 0).toLocaleString('en-IN')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest min-w-[45px]">Term</span>
                      <span className="text-indigo-600 font-semibold text-lg">{state.emisPaid + 1}/{loan.tenureMonths}</span>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center gap-4 justify-end">
                    <button 
                      onClick={() => navigate('/loans')}
                      className="text-[10px] font-bold text-slate-400 hover:text-indigo-500 uppercase tracking-widest transition-colors"
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
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em]">Subscriptions</h2>
            <button onClick={() => setShowModal('subscription')} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">+ Add Subscription</button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {subscriptions.length === 0 ? (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No subscriptions added</p>
            ) : subscriptions.map(sub => (
              <ItemCard
                key={sub.id}
                item={sub}
                type="subscription"
                onTogglePaid={() => togglePaid('subscription', sub)}
                onDelete={() => handleDelete('subscription', sub.id)}
              />
            ))}
          </div>
        </section>

        {/* Other Expenses Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em]">Other Expenses</h2>
            <button onClick={() => setShowModal('expense')} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">+ Add Expense</button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {expenses.length === 0 ? (
              <p className="text-base text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No expenses added</p>
            ) : expenses.map(exp => (
              <ItemCard
                key={exp.id}
                item={exp}
                type="expense"
                onTogglePaid={() => togglePaid('expense', exp)}
                onDelete={() => handleDelete('expense', exp.id)}
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
    </div>
  )
}

function getOrdinal(n) {
  if (!n) return ''
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function ItemCard({ item, type, onTogglePaid, onDelete, onUpdateBill }) {
  const [showDetails, setShowDetails] = useState(false)
  const amount = type === 'card' ? item.bill_amount : item.amount
  const isPaid = item.paid

  // Local state for the input to prevent typing lag
  const [localAmount, setLocalAmount] = useState(amount || '')

  // Update local state if the parent amount changes
  useEffect(() => {
    setLocalAmount(amount || '')
  }, [amount])

  const handleBlur = () => {
    if (localAmount !== amount) {
      onUpdateBill(localAmount)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur() // Trigger handleBlur
    }
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden group shadow-sm hover:shadow-md hover:border-indigo-100 transition-all duration-300">
      <div className="py-4 px-6 flex items-center gap-12">
        {/* Left: Nickname & Details Toggle (Fixed Width) */}
        <div className="flex flex-col w-[240px] shrink-0">
          <span className="text-lg font-semibold text-slate-800 truncate tracking-tight leading-tight group-hover:text-indigo-600 transition-colors">{item.nickname}</span>
          <button 
            onClick={() => setShowDetails(!showDetails)}
            className="text-[10px] font-bold text-slate-400 hover:text-indigo-500 flex items-center gap-1 mt-1 text-left transition-colors tracking-widest uppercase"
          >
            <span>{showDetails ? '▴ Hide Details' : '▾ Show Details'}</span>
          </button>
        </div>

        {/* Middle: Aligned Info Columns (Fixed Widths for Perfect Alignment) */}
        <div className="grid grid-cols-[120px_160px_100px] gap-4 text-base text-slate-500 font-medium shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest min-w-[35px]">Due</span>
            <span className="text-slate-700 font-semibold">{item.due_date ? getOrdinal(item.due_date) : '—'}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest min-w-[55px]">Amount</span>
            {isPaid ? (
              <span className="text-emerald-600 font-bold text-[10px] bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 tracking-widest uppercase">Paid</span>
            ) : (
              <span className="font-mono font-bold text-lg text-slate-800">
                <span className="text-indigo-600/60 mr-0.5 font-sans">₹</span>{(amount || 0).toLocaleString('en-IN')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {type === 'emi' && (
              <>
                <span className="text-[10px] text-slate-400 uppercase tracking-widest min-w-[40px]">Term</span>
                <span className="text-indigo-600 font-semibold text-lg">{item.current_month}/{item.total_months}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: Actions (Pushed to end) */}
        <div className="flex-1 flex items-center gap-4 justify-end">
          {type === 'card' && !isPaid && (
            <input 
              type="number"
              value={localAmount}
              onChange={(e) => setLocalAmount(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder="Set bill"
              className="w-24 px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50/30 transition-all"
            />
          )}

          {/* Only show Mark Paid for Credit Cards */}
          {type === 'card' && (
            <button 
              onClick={onTogglePaid}
              className={`px-5 py-1.5 text-[10px] font-bold rounded-full border transition-all shadow-sm tracking-widest uppercase ${
                isPaid 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600 cursor-default' 
                : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-500 hover:text-indigo-600 active:scale-95'
              }`}
            >
              {isPaid ? 'Settled ✓' : 'Mark Paid'}
            </button>
          )}

          <button 
            onClick={onDelete}
            className="text-slate-300 hover:text-rose-500 transition-colors p-1.5 rounded-lg hover:bg-rose-50"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {showDetails && (
        <div className="bg-slate-50/50 border-t border-slate-100 px-8 py-4 grid grid-cols-2 md:grid-cols-4 gap-8">
          {type === 'card' && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Full Card Name</p>
              <p className="text-sm font-semibold text-slate-700">{item.card_name || '—'}</p>
            </div>
          )}

          <div className="space-y-0.5">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total Paid</p>
            <p className="text-sm font-mono font-semibold text-slate-700">{formatINR(item.total_paid || 0)}</p>
          </div>
          
          {type === 'card' && (
            <>
              <div className="space-y-0.5">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Annual Fee</p>
                <p className="text-sm font-semibold text-slate-700">
                  {item.annual_fee_type === 'LTF' 
                    ? <span className="text-emerald-600">LTF</span> 
                    : `${formatINR(item.annual_fee)} in ${item.fee_month}`
                  }
                </p>
              </div>
              {item.annual_fee_type === 'paid' && (
                <div className="space-y-0.5">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Waiver Target</p>
                  <p className="text-sm font-semibold text-slate-700">{formatINR(item.waiver_amount)}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AddModal({ type, onClose, onAdd }) {
  const [nickname, setNickname] = useState('')
  const [cardName, setCardName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [feeType, setFeeType] = useState('LTF')
  const [annualFee, setAnnualFee] = useState('')
  const [feeMonth, setFeeMonth] = useState('')
  const [waiverAmount, setWaiverAmount] = useState('')
  const [totalMonths, setTotalMonths] = useState('')
  const [currentMonth, setCurrentMonth] = useState('0')

  const titles = {
    card: 'Add Credit Card',
    subscription: 'Add Subscription',
    expense: 'Add Expense'
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!nickname) return alert('Nickname is required')

    const data = {
      nickname,
      due_date: dueDate,
      paid: false,
    }

    if (type === 'card') {
      data.card_name = cardName
      data.bill_amount = 0
      data.annual_fee_type = feeType
      data.annual_fee = feeType === 'paid' ? parseFloat(annualFee) : null
      data.fee_month = feeType === 'paid' ? feeMonth : null
      data.waiver_amount = feeType === 'paid' ? parseFloat(waiverAmount) : null
    } else {
      data.amount = parseFloat(amount) || 0
    }

    if (type === 'emi') {
      data.total_months = parseInt(totalMonths) || 1
      data.current_month = parseInt(currentMonth) || 0
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
                      {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
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

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition-colors mt-6 text-xs uppercase tracking-widest"
          >
            Add {type}
          </button>
        </form>
      </div>
    </div>
  )
}