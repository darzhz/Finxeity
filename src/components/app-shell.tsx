import { NavLink, Outlet } from 'react-router'
import { History, LayoutDashboard, Receipt, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNativeBack } from '@/hooks/use-native-back'

const tabs = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Spending', icon: Receipt },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

export function AppShell() {
  useNativeBack()

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <main className="min-h-0 flex-1 overflow-hidden pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 bg-background/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_12px_rgba(0,0,0,0.12)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-1">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 min-w-[56px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon className="size-[22px]" />
              <span className="tracking-wide">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
