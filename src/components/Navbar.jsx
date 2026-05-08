import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithGoogle, signOut } from '../data/cloudStorage'

export default function Navbar({ session, activePage }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const navigate = useNavigate()

  const navItems = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Loans', path: '/loans' },
    { label: 'Add Loan', path: '/add' },
    { label: 'Simulator', path: '/simulator' },
    { label: 'Loan Insights', path: '/insights' },
    { label: 'Card Insights', path: '/card-intelligence' },
    { label: 'Alerts', path: '/alerts' },
  ]

  const handleNavigate = (path) => {
    navigate(path)
    setIsMenuOpen(false)
  }

  return (
    <>
      {/* Guest banner */}
      {!session && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2 flex items-center justify-between">
          <p className="text-[10px] sm:text-xs text-amber-700">
            You are browsing as a guest. Data is saved locally.
          </p>
          <button
            onClick={signInWithGoogle}
            className="text-[10px] sm:text-xs font-medium text-amber-700 border border-amber-300 px-2 sm:px-3 py-1 rounded-lg hover:bg-amber-100 transition whitespace-nowrap"
          >
            Sign in →
          </button>
        </div>
      )}

      <nav className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sticky top-0 z-50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Logo Section */}
          <div className="flex flex-col cursor-pointer shrink-0" onClick={() => navigate('/')}>
            <span className="text-sm sm:text-base md:text-lg font-bold text-gray-900 leading-tight">
              Smart <span className="text-green-600">Finance</span> <span className="hidden xs:inline">System</span>
            </span>
            <span className="hidden md:block text-[8px] font-bold text-gray-400 uppercase tracking-[0.15em] leading-tight mt-0.5">
              Strategic Loan & Card Optimization
            </span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map(item => (
              <button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                className={`px-3 py-1.5 rounded-md text-sm transition font-medium ${
                  activePage === item.label
                    ? 'bg-green-50 text-green-700'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* User Profile & Hamburger */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              {session && (
                <div className="flex items-center gap-2 mr-2">
                  {session.user.user_metadata?.avatar_url && (
                    <img
                      src={session.user.user_metadata.avatar_url}
                      alt="avatar"
                      className="w-7 h-7 rounded-full border border-gray-100 shadow-sm"
                    />
                  )}
                  <span className="hidden xl:block text-xs font-medium text-gray-600 max-w-[120px] truncate">
                    {session.user.user_metadata?.full_name || session.user.email}
                  </span>
                </div>
              )}
              {session ? (
                <button
                  onClick={signOut}
                  className="text-xs font-bold text-gray-400 hover:text-rose-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition-colors uppercase tracking-wider"
                >
                  Exit
                </button>
              ) : (
                <button
                  onClick={signInWithGoogle}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-gray-800 transition-all shadow-sm uppercase tracking-wider"
                >
                  Sign In
                </button>
              )}
            </div>

            {/* Hamburger Button */}
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="lg:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition"
              aria-label="Toggle menu"
            >
              {isMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        {isMenuOpen && (
          <div className="lg:hidden absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-xl py-4 px-6 animate-in slide-in-from-top duration-200 z-40">
            <div className="flex flex-col gap-2">
              {navItems.map(item => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={`w-full text-left px-4 py-3 rounded-xl text-base font-semibold transition ${
                    activePage === item.label
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              
              <hr className="my-2 border-gray-100" />
              
              {!session ? (
                <button
                  onClick={signInWithGoogle}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-xl font-bold uppercase tracking-widest text-sm shadow-md"
                >
                  Sign In with Google
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-xl">
                    {session.user.user_metadata?.avatar_url && (
                      <img
                        src={session.user.user_metadata.avatar_url}
                        alt="avatar"
                        className="w-10 h-10 rounded-full border-2 border-white shadow-sm"
                      />
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-gray-900">
                        {session.user.user_metadata?.full_name || 'User'}
                      </span>
                      <span className="text-xs text-gray-500 truncate max-w-[200px]">
                        {session.user.email}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={signOut}
                    className="w-full px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-rose-50 hover:text-rose-600 hover:border-rose-100 transition-all uppercase tracking-widest text-sm"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  )
}