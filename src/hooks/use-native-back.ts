import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useNavigate, useLocation } from 'react-router'

/**
 * Android hardware back: go back in the router, otherwise minimize the app.
 */
export function useNativeBack() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let removeHandle: (() => void) | undefined

    App.addListener('backButton', ({ canGoBack }) => {
      const atRoot = location.pathname === '/' || location.pathname === '/dashboard'
      if (canGoBack && !atRoot) {
        navigate(-1)
      } else {
        App.minimizeApp()
      }
    }).then((handle) => {
      removeHandle = () => handle.remove()
    })

    return () => {
      removeHandle?.()
    }
  }, [navigate, location.pathname])
}
