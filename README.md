# tiny-batch

Coalesce bursts of calls into one invocation per scheduling window

# About

The wrapper batches calls that happen before the next scheduled flush. By default it uses a microtask (queueMicrotask when available, otherwise Promise.then). You can provide a custom scheduler to debounce or align to frames. The module has no dependencies and runs in modern Node, browsers, and Deno. Import with ESM.

One batch produces one invocation of your function. All Promises created in that batch resolve or reject with the same value or error. In the default “last” mode, the last call’s arguments win. In “merge” mode, you provide a pure reducer that combines argument tuples deterministically at enqueue time.

Batches are independent. A new batch can start while a previous invocation is still running; the wrapper does not serialize calls or enforce “only one in flight.” The cancel method rejects only the currently accumulated (not yet flushed) calls. The flush method forces an immediate run if arguments are pending. The pending method reflects accumulation, not execution.

# Usage

```ts
import { batch } from "tiny-batch";

// Default: "last" — the last call's args win within the batch.
const times2 = batch((n: number) => n * 2);

const p1 = times2(1);
const p2 = times2(2);
const out = await Promise.all([p1, p2]); // [4, 4] — fn ran once with (2)
```

```ts
import { batch, type Reducer } from "tiny-batch";

// "merge" — reduce argument tuples across the batch.
type Args = [number];
const sumReducer: Reducer<Args> = (acc, next) => [acc[0] + next[0]];

const sum = batch((n: number) => n, { mode: "merge", reducer: sumReducer });

const all = await Promise.all([sum(1), sum(2), sum(3)]); // [6, 6, 6] — fn ran once with (6)
```

```ts
import { batch } from "tiny-batch";

// Custom schedule — debounce with a timer or align to a frame.
const write = (s: string) => s.length;
const debounced = batch(write, { schedule: (flush) => setTimeout(flush, 10) });

const a = debounced("a");
const b = debounced("ab");
console.log(await Promise.all([a, b])); // [2, 2]
```

```ts
import { batch } from "tiny-batch";

// Control methods affect only the currently accumulated batch.
const work = batch((x: number) => x);

work.pending(); // false
const p = work(1);
work.pending(); // true
work.flush(); // runs immediately if pending
work.cancel(); // rejects only pending calls (no effect on an invocation already in flight)
```

# License

MIT
