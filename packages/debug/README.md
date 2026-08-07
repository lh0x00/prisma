# @vertexa/prisma-debug

Fork of `@prisma/debug` — a cached [`debug`](https://github.com/visionmedia/debug/) logger.

⚠️ **Internal package** — consumed by other `@vertexa/*` packages. Do not depend on it directly.

## Usage

```ts
import Debug, { getLogs } from '@vertexa/prisma-debug'

const debug = Debug('my-namespace')

try {
  debug('hello')
  debug(process.env)
  throw new Error('oops')
} catch (e) {
  console.error(e)
  console.error(`We just crashed. But no worries, here are the debug logs:`)
  // get 10 last lines of debug logs
  console.error(getLogs(10))
}
```
