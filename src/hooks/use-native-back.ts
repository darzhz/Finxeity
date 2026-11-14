import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { subscribeToListeners } from '@/lib/subscriptions'
import { useNavigate, useLocation } from 'react-router'

export function useNativeBack() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    return subscribeToListeners(() =>
      App.addListener('backButton', ({ canGoBack }) => {
        const atRoot = location.pathname === '/' || location.pathname === '/dashboard'
        if (canGoBack && !atRoot) {
          navigate(-1)
        } else {
          void App.minimizeApp()
        }
      }),
    )
  }, [navigate, location.pathname])
}
