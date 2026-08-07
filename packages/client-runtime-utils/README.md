# @vertexa/prisma-client-runtime-utils

Fork of `@prisma/client-runtime-utils` — utility types and singleton instances used by Prisma Client.

These are reexported by generated clients but can also be directly imported from here.
This is useful for cases where one does not want to depend on a specific generated Prisma Client.

Example usage:

```
import { PrismaClientKnownRequestError, DbNull, Decimal } from '@vertexa/prisma-client-runtime-utils'
```
