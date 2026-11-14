type ListenerHandle = { remove: () => void }

export function subscribeToListeners(...register: Array<() => Promise<ListenerHandle>>): () => void {
  let disposed = false
  let handles: ListenerHandle[] = []

  void Promise.all(register.map((start) => start())).then((resolved) => {
    if (disposed) {
      resolved.forEach((handle) => handle.remove())
    } else {
      handles = resolved
    }
  })

  return () => {
    disposed = true
    handles.forEach((handle) => handle.remove())
    handles = []
  }
}
