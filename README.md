# tiny-batch

Coalesce many rapid calls into one, scheduled in a microtask.

# Usage

```ts
import { batch } from 'tiny-batch'

// default: "last" — uses the last call's args
const b = batch((n: number) => n * 2)

const p1 = b(1)
const p2 = b(2)
const out = await Promise.all([p1, p2]) // [4, 4] — fn ran once with (2)
```

```ts
// "merge" — reduce args across the batch
const sum = batch((n: number) => n, {
  mode: 'merge',
  reducer: (acc, args) => [acc[0]! + args[0]!] as [number]
})
await Promise.all([sum(1), sum(2), sum(3)]) // [6, 6, 6]
```

```ts
// control
const x = batch(doWork)
x.flush() // run now if pending
x.cancel() // reject all pending
x.pending() // boolean
```

# API

- `batch(fn, options?): BatchedFn`
- `BatchedFn(...args): Promise<Return>`
- `BatchedFn.flush(): void`
- `BatchedFn.cancel(reason?): void`
- `BatchedFn.pending(): boolean`

Options

- `mode: 'last' | 'merge'` (default: `'last'`)
- `reducer: (acc, args) => acc` (required for `'merge'`)
- `schedule: (flush) => void` (default: microtask)

# License

MIT
