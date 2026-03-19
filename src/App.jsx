import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { onAuthChange } from './data/cloudStorage'
import Dashboard from './pages/Dashboard'
import AddLoan from './pages/AddLoan'
import EditLoan from './pages/EditLoan'
import LoanDetail from './pages/LoanDetail'
import Simulator from './pages/Simulator'
import Insights from './pages/Insights'
import Alerts from './pages/Alerts'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    const { data: { subscription } } = onAuthChange(setSession)
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard session={session} />} />
        <Route path="/add" element={<AddLoan session={session} />} />
        <Route path="/edit/:id" element={<EditLoan session={session} />} />
        <Route path="/loan/:id" element={<LoanDetail session={session} />} />
        <Route path="/simulator" element={<Simulator session={session} />} />
        <Route path="/insights" element={<Insights session={session} />} />
        <Route path="/alerts" element={<Alerts session={session} />} />
      </Routes>
    </BrowserRouter>
  )
}