# tiny-batch

Coalesce bursts of calls into one invocation per scheduling window.

## About

`tiny-batch` wraps a function and batches calls that happen before the next scheduled flush. By default, it uses `queueMicrotask`. A custom scheduler can be provided for debounce, animation frames, or other scheduling strategies.

One batch produces one invocation. All Promises created in the batch resolve with the same value or reject with the same error.

In `"last"` mode, the last call's arguments win. In `"merge"` mode, a reducer combines argument tuples as they are enqueued.

Batches are independent. A new batch can start while a previous invocation is still running.

## Usage

```ts
import { batch } from "tiny-batch";

const times2 = batch((n: number) => n * 2);

const p1 = times2(1);
const p2 = times2(2);

console.log(await Promise.all([p1, p2])); // [4, 4]
```

### Merge

```ts
import { batch, type Reducer } from "tiny-batch";

type Args = [number];

const reducer: Reducer<Args> = (acc, next) => [acc[0] + next[0]];

const sum = batch((n: number) => n, {
  mode: "merge",
  reducer,
});

console.log(await Promise.all([sum(1), sum(2), sum(3)])); // [6, 6, 6]
```

### Custom scheduler

```ts
const write = batch((s: string) => s.length, {
  schedule: (flush) => setTimeout(flush, 10),
});

const p1 = write("a");
const p2 = write("ab");

console.log(await Promise.all([p1, p2])); // [2, 2]
```

### Controls

```ts
const work = batch((x: number) => x);

const p = work(1);

work.pending(); // true
work.flush(); // flush pending calls immediately
work.pending(); // false
```

`cancel(reason?)` rejects calls in the pending batch. It does not affect an invocation that has already started.

`pending()` reflects queued arguments only. It may return `false` while a previous invocation is still running.

## License

MIT
