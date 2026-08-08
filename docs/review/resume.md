# Picking Up — resume sketch

A tighter, resume-formatted version of the same project, pulled from the
portfolio draft (`picking-up-project-writeup-draft.md`). Resume bullets read
differently than portfolio prose — action-verb-first, no "I," quantified
where the numbers are real. Trim to whatever fits your resume's space
budget; the bullets are roughly ordered by how strongly they support a
backend-specialist story, not by importance.

---

## Draft entry

**Picking Up** — Personal task and routine planner
*Next.js, TypeScript, Django REST Framework, PostgreSQL/Oracle · Solo project · [dates] · [repo link]*

- Replaced non-atomic, client-driven task mutations with versioned,
  transactional server commands (optimistic concurrency control, 409-on-
  conflict), eliminating race conditions across nested/promoted/rescheduled
  task operations.
- Found and fixed a TOCTOU race in case-insensitive category uniqueness by
  moving the invariant to a database constraint instead of relying on an
  application-level check alone.
- Diagnosed an authentication-throttling defect where a burst of failed
  logins from a single IP could lock out the login endpoint site-wide;
  redesigned the throttle interaction and added regression coverage.
- Designed a two-layer domain-validation strategy — serializer-level rules
  plus portable database `CHECK` constraints — with documented rationale for
  which layer enforces which rule.
- Built a Next.js BFF layer so browser JavaScript never handles JWTs
  directly; access/refresh tokens are held in HTTP-only cookies and attached
  server-side on requests to the Django API.
- Maintained a running engineering-issue register (20+ tracked defects) with
  root-cause analysis and verified resolutions for each.
- Set up CI (GitHub Actions) running backend and frontend test suites,
  linting, and type-checking on every pull request.
- [Optional, if you want a coverage number] Backend and frontend test
  suites currently pass 161 and 819+ tests respectively — fill in the
  real current counts before using this, since they'll keep moving.

## Notes for the conversation (not resume copy)

- I kept every bullet to things I can point at real code/commits for — no
  "scalable," "robust," or "seamless" filler. If a bullet feels thin without
  those words, that's a sign to either add a real specific or cut it, not
  to add the adjective back.
- The BFF/JWT bullet and the CI bullet are more "solid engineering hygiene"
  than "found a hard bug" — cut either if you're tight on space, since the
  concurrency/race-condition bullets carry the backend-specialist story
  more strongly.
- The test-count bullet is bracketed as optional and needs a real check
  before it goes on an actual resume — numbers on a resume get
  fact-checked more than portfolio prose does, and these will be stale by
  the time you're job-hunting again.
- Didn't invent a company name, team size, or user count — there isn't one,
  and a resume bullet that implies otherwise for a personal project is the
  kind of thing that falls apart in an interview follow-up question.
