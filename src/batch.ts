export type Reducer<A extends any[]> = (acc: Readonly<A>, args: Readonly<A>) => A | Readonly<A>;

export interface BatchOptions<A extends any[]> {
  mode?: "last" | "merge";
  reducer?: Reducer<A>;
  schedule?: (flush: () => void) => void;
}

type AwaitedReturn<F> = F extends (...args: any[]) => infer R ? Awaited<R> : never;

export type Batched<F extends (...args: any[]) => any> = ((
  ...args: Parameters<F>
) => Promise<AwaitedReturn<F>>) & {
  flush(): void;
  cancel(reason?: unknown): void;
  pending(): boolean;
};

export function batch<F extends (...args: any[]) => any>(
  fn: F,
  opts: BatchOptions<Parameters<F>> = {},
): Batched<F> {
  if (opts.mode === "merge" && !opts.reducer) {
    throw new Error('batch: mode "merge" requires a reducer');
  }

  let acc: Readonly<Parameters<F>> | undefined;
  let scheduled = false;
  let flushToken = 0;

  const resolves: Array<(v: AwaitedReturn<F>) => void> = [];
  const rejects: Array<(e: unknown) => void> = [];

  const schedule = opts.schedule ?? ((flush: () => void) => queueMicrotask(flush));

  const doFlush = (): void => {
    scheduled = false;
    const args = acc;
    acc = undefined;

    const rs = resolves.splice(0, resolves.length);
    const rj = rejects.splice(0, rejects.length);

    if (!args) return;

    let out: ReturnType<F>;
    try {
      out = fn(...args);
    } catch (err) {
      for (const f of rj) f(err);
      return;
    }

    if (out && typeof out.then === "function") {
      (out as PromiseLike<unknown>).then(
        (v) => {
          for (const f of rs) f(v as AwaitedReturn<F>);
        },
        (e) => {
          for (const f of rj) f(e);
        },
      );
    } else {
      for (const f of rs) f(out as AwaitedReturn<F>);
    }
  };

  const wrapped: Batched<F> = (...args: Parameters<F>): Promise<AwaitedReturn<F>> => {
    const p = new Promise<AwaitedReturn<F>>((resolve, reject) => {
      try {
        if (opts.mode === "merge") {
          const reducer = opts.reducer as Reducer<Parameters<F>>;
          acc = acc ? reducer(acc, args) : args;
        } else {
          acc = args;
        }
      } catch (err) {
        reject(err);
        return;
      }

      resolves.push(resolve);
      rejects.push(reject);

      if (!scheduled) {
        scheduled = true;
        const currentToken = ++flushToken;

        schedule(() => {
          if (currentToken === flushToken) doFlush();
        });
      }
    });

    return p;
  };

  wrapped.flush = () => {
    if (acc) {
      flushToken++;
      doFlush();
    }
  };

  wrapped.cancel = (reason?: unknown) => {
    flushToken++;
    acc = undefined;
    scheduled = false;

    const err = reason ?? new Error("batch: cancelled");
    const rj = rejects.splice(0, rejects.length);
    resolves.splice(0, resolves.length);
    for (const f of rj) f(err);
  };

  wrapped.pending = () => acc != null;

  return wrapped;
}
