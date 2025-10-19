/** A pure combiner for argument tuples used by "merge" mode.
 *
 * @public
 * @example
 * import type { Reducer } from './batch';
 *
 * // Merge two single-argument object updates left-to-right.
 * type Args = [update: Readonly<Record<string, number>>];
 * const mergeUpdates: Reducer<Args> = (acc, next) => [{ ...acc[0], ...next[0] }];
 */
export type Reducer<A extends any[]> = (acc: Readonly<A>, args: Readonly<A>) => A | Readonly<A>

/**
 * Controls how arguments are coalesced and when a flush runs.
 *
 * @remarks
 * Default mode is "last": later calls overwrite earlier arguments within the same microtask,
 * which is a good fit for idempotent "set" operations. Use "merge" to combine calls when
 * every update carries partial information that benefits from composition.
 *
 * @public
 */
export interface BatchOptions<A extends any[]> {
  mode?: 'last' | 'merge';
  reducer?: Reducer<A>
  schedule?: (flush: () => void) => void
}

type AwaitedReturn<F> = F extends (...args: any[]) => infer R ? Awaited<R> : never

/**
 * The callable wrapper returned by {@link batch} with control methods.
 *
 * @remarks
 * The callable resolves all promises created in the same batch with the same value,
 * or rejects them all with the same error. Errors thrown by the underlying function
 * are captured and broadcast; they do not bubble synchronously from the call site.
 *
 * The control methods affect only the currently accumulated (not yet flushed) batch.
 * They do not cancel a call that is already in flight, because the invocation has
 * already been issued to your function at that point.
 *
 * The pending() check is about accumulation, not execution: it returns true when arguments
 * are queued for the next flush. It may return false while a previous invocation is still running.
 *
 * @public
 * @example
 * import { batch } from './batch';
 *
 * const fn = (x: number) => x * 2;
 * const b = batch(fn);
 *
 * (async () => {
 *   const p1 = b(1);
 *   const p2 = b(2); // same microtask, last args (2) win in default mode
 *   const [a, c] = await Promise.all([p1, p2]);
 *   console.log(a, c); // 4 4
 *   console.log(b.pending()); // false (no accumulated args)
 *   b.cancel(); // no-op here: nothing queued to cancel
 * })();
 */
export type Batched<F extends (...args: any[]) => any> = ((...args: Parameters<F>) => Promise<AwaitedReturn<F>>) & {
  flush(): void
  cancel(reason?: unknown): void
  pending(): boolean
}

/**
 * Wraps a function so that calls in the same scheduling window are coalesced into one invocation.
 *
 * @public
 * @param fn The function to invoke once per batch; may be sync or return a Promise/thenable.
 * @param opts Coalescing mode, reducer for "merge", and scheduling strategy.
 * @returns A callable that batches arguments and exposes flush/cancel/pending controls.
 * @throws Error When mode is "merge" and no reducer is provided.
 *
 * @example
 * import { batch, type Reducer } from './batch';
 *
 * // Merge updates: combine partial objects and apply once.
 * type Update = Readonly<Record<string, number>>;
 * const apply = (u: Update) => Object.keys(u).length; // sync or async, both work
 * const reducer: Reducer<[Update]> = (acc, next) => [{ ...acc[0], ...next[0] }];
 * const applyBatched = batch(apply, { mode: 'merge', reducer });
 *
 * (async () => {
 *   const a = applyBatched({ a: 1 });
 *   const b = applyBatched({ b: 2 });
 *   const count = await b; // both promises resolve with the same value
 *   console.log(count); // 2 (apply called once with { a: 1, b: 2 })
 * })();
 *
 * @example
 * import { batch } from './batch';
 *
 * // Custom schedule: debounce with a timer.
 * const write = (s: string) => s.length;
 * const debounced = batch(write, { schedule: (flush) => setTimeout(flush, 10) });
 *
 * (async () => {
 *   const p1 = debounced('a');
 *   const p2 = debounced('ab');
 *   const [x, y] = await Promise.all([p1, p2]);
 *   console.log(x, y); // 2 2 (last call in the window wins)
 * })();
 */
export function batch<F extends (...args: any[]) => any> (fn: F, opts: BatchOptions<Parameters<F>> = {}): Batched<F> {
  if (opts.mode === 'merge' && !opts.reducer) {
    throw new Error('batch: mode "merge" requires a reducer')
  }

  let acc: Readonly<Parameters<F>> | undefined
  let scheduled = false
  const resolves: Array<(v: any) => void> = []
  const rejects: Array<(e: any) => void> = []
  const schedule = opts.schedule ?? ((flush: () => void) =>
    (typeof queueMicrotask === 'function' ? queueMicrotask(flush) : Promise.resolve().then(flush)))

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
      ;(out as Promise<any>).then(
        v => { for (const f of rs) f(v) },
        e => { for (const f of rj) f(e) }
      )
    } else {
      for (const f of rs) f(out)
    }
  }

  const wrapped = ((...args: Parameters<F>) => {
    if (opts.mode === 'merge') {
      const reducer = opts.reducer as Reducer<Parameters<F>>
      acc = acc ? reducer(acc, args) : args
    } else {
      acc = args
    }

    const p = new Promise<any>((resolve, reject) => {
      resolves.push(resolve)
      rejects.push(reject)
    })

    if (!scheduled) {
      scheduled = true
      schedule(doFlush)
    }

    return p
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
