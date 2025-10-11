export type Reducer<A extends any[]> = (acc: A, args: A) => A

export interface BatchOptions<A extends any[]> {
  mode?: 'last' | 'merge';
  reducer?: Reducer<A>
  schedule?: (flush: () => void) => void
}

type AwaitedReturn<F> = F extends (...args: any[]) => infer R ? Awaited<R> : never

export type Batched<F extends (...args: any[]) => any> = ((...args: Parameters<F>) => Promise<AwaitedReturn<F>>) & {
  flush(): void
  cancel(reason?: unknown): void
  pending(): boolean
}

export function batch<F extends (...args: any[]) => any> (fn: F, opts: BatchOptions<Parameters<F>> = {}): Batched<F> {
  let acc: Parameters<F> | undefined
  let scheduled = false
  const resolves: Array<(v: any) => void> = []
  const rejects: Array<(e: any) => void> = []
  const schedule = opts.schedule ?? ((flush: () => void) => (typeof queueMicrotask === 'function' ? queueMicrotask(flush) : Promise.resolve().then(flush)))

  const doFlush = (): void => {
    scheduled = false
    const args = acc
    acc = undefined
    const rs = resolves.splice(0, resolves.length)
    const rj = rejects.splice(0, rejects.length)
    if (!args) return
    let out: any
    try {
      out = fn(...args)
    } catch (err) {
      for (const f of rj) f(err)
      return
    }
    if (out && typeof out.then === 'function') {
      ;(out as Promise<any>).then(v => { for (const f of rs) f(v) }, e => { for (const f of rj) f(e) })
    } else {
      for (const f of rs) f(out)
    }
  }

  const wrapped = ((...args: Parameters<F>) => {
    if (opts.mode === 'merge' && opts.reducer) {
      acc = acc ? opts.reducer(acc, args) : args
    } else {
      acc = args
    }
    if (!scheduled) {
      scheduled = true
      schedule(doFlush)
    }
    return new Promise<any>((resolve, reject) => {
      resolves.push(resolve)
      rejects.push(reject)
    })
  }) as Batched<F>

  wrapped.flush = () => { if (acc) doFlush() }
  wrapped.cancel = (reason?: unknown) => {
    acc = undefined
    scheduled = false
    const err = reason ?? new Error('batch: cancelled')
    const rj = rejects.splice(0, rejects.length)
    resolves.splice(0, resolves.length)
    for (const f of rj) f(err)
  }
  wrapped.pending = () => acc != null

  return wrapped
}
