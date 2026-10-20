import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// The globals are off in this project, so testing library cannot register its
// own cleanup. Without this the DOM of one test leaks into the next.
afterEach(() => {
  cleanup()
})

// Charts measure their container, and jsdom has no ResizeObserver.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
}
