# RF-017: Server-owned routine materialization and rollover

- Date: 2026-08-06
- Issue: RF-017
- Priority: P0
- Status: Open

_Acceptance criteria updated 2026-08-12 for the production database migration
from Oracle to Neon PostgreSQL._

## Current risk

Routine materialization and rollover still run in the browser. Two sessions can
both observe that an occurrence is absent and create different client-generated
UUID Tasks for the same repeat anchor and local date. Task UUID uniqueness does
not prevent this because each session chooses a different UUID.

This is separate from RF-005. RF-005 moves user-requested structural mutations
to transactional commands; RF-017 defines one authoritative day-boundary
operation and one database identity for a logical occurrence.

## Required server contract

The implementation is not accepted until it defines all of the following:

1. **Timezone authority.** Persist the user's IANA timezone and derive the local
   occurrence date on the server. Specify behavior across DST gaps/folds and a
   timezone change after a routine is created.
2. **Occurrence identity.** Enforce a database uniqueness invariant for
   one logical `(user, repeat anchor, occurrence local date)` tuple. A random
   Task UUID remains row identity, not occurrence identity.
3. **Idempotent operation.** A materialize/rollover command must accept an
   idempotency key or use the occurrence identity itself, return the existing
   result on safe retry, and define the response after an earlier commit whose
   network response was lost.
4. **Transactional scope.** Lock the owner/anchor/affected occurrences in a
   deterministic order. Exclusions, rollover history, occurrence creation, and
   any source update must commit or roll back together.
5. **Legacy migration.** Detect existing duplicate logical occurrences,
   deterministically select survivors, preserve/repoint dependent data, and
   record how ambiguous user edits are handled before adding uniqueness.
6. **Client cutover.** Remove browser UUID generation/materialization after the
   server contract is deployed. During transition, old and new clients must not
   both remain authorities.

## Required verification

- two independent sessions invoke the same date concurrently and produce one
  logical occurrence;
- an ambiguous timeout followed by retry returns the committed occurrence;
- excluded dates and deleted/detached occurrences do not resurrect;
- DST boundary dates and user-timezone changes follow the documented policy;
- the legacy-duplicate migration is covered with dependent rows;
- SQLite unit/migration tests pass, and real PostgreSQL
  contention/uniqueness behavior is executed under RF-012 rather than inferred
  from SQLite.

## Deliberately not implemented in the review-fix PR

The review-fix branch documents this acceptance contract but does not invent a
timezone/product policy or silently migrate user routines. Those choices change
product behavior and schema identity, so RF-017 remains Open until implemented
as its own reviewed backend slice.
