import { useNavigate } from 'react-router-dom'
import { signInWithGoogle, signOut } from '../data/cloudStorage'

export default function Navbar({ session, activePage }) {
  const navigate = useNavigate()

  const navItems = [
    { label: 'Dashboard', path: '/' },
    { label: 'Add Loan', path: '/add' },
    { label: 'Simulator', path: '/simulator' },
    { label: 'Insights', path: '/insights' },
    { label: 'Alerts', path: '/alerts' },
  ]

  return (
    <>
      {/* Guest banner */}
      {!session && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between">
          <p className="text-xs text-amber-700">
            You are browsing as a guest. Data is saved locally on this device only.
          </p>
          <button
            onClick={signInWithGoogle}
            className="text-xs font-medium text-amber-700 border border-amber-300 px-3 py-1 rounded-lg hover:bg-amber-100 transition"
          >
            Sign in with Google to save to cloud →
          </button>
        </div>
      )}

      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <span className="text-lg font-semibold text-gray-900 cursor-pointer" onClick={() => navigate('/')}>
          Loan <span className="text-green-600">Portfolio</span> Management System
        </span>

        <div className="flex gap-1 text-sm">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                activePage === item.label
                  ? 'bg-gray-100 text-gray-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {session ? (
            <>
              <div className="flex items-center gap-2">
                {session.user.user_metadata?.avatar_url && (
                  <img
                    src={session.user.user_metadata.avatar_url}
                    alt="avatar"
                    className="w-7 h-7 rounded-full border border-gray-200"
                  />
                )}
                <span className="text-xs text-gray-500 max-w-32 truncate">
                  {session.user.user_metadata?.full_name || session.user.email}
                </span>
              </div>
              <button
                onClick={signOut}
                className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={signInWithGoogle}
              className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              <svg width="14" height="14" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Sign in
            </button>
          )}
        </div>
      </nav>
    </>
  )
}