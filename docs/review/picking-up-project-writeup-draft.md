# Picking Up — portfolio write-up draft

Draft for the `jfloww-portfolio` project entry (would eventually become
`app/projects/contents/picking-up.mdx`, following the same frontmatter +
section shape as `jfloww-project.mdx`). This is a sketch to react to, not
final copy — flag anything that doesn't sound like you, anything you'd cut,
and anything you want to say instead.

---

## Frontmatter (draft — fill in real values before this becomes a real MDX file)

```yaml
---
title: 'Picking Up'
date: 'YYYYMMDD'
techStack: 'Next.js, TypeScript, Django REST Framework, PostgreSQL/Oracle'
id: picking-up
showSlider: true
hidden: false
images:
  - src: '/photo/proj/picking-up/TODO-main.png'
    title: 'Weekly view'
    description: 'TODO'
  # add more screenshots — drawer detail view, subtask panel, etc.
---
```

---

## Draft body

# Project Summary

**Purpose:** I wanted a to-do app that actually matched how I plan my week —
routines that repeat, tasks that roll over when I miss a day, subtasks with
their own notes — and I kept hitting the ceiling of every app I tried. So I
built my own, and used it as an excuse to hold myself to backend standards I
don't always get to apply at work: versioned writes, real concurrency
handling, a paper trail for every bug I found.

**My role:** Solo — backend API, data model, frontend, and the engineering
process around both.

## Core Functionality

- Daily, weekly, monthly, and bucket-list views over the same task data
- Routines that materialize recurring tasks and roll missed ones forward
- Subtasks with their own notes, and one-click promotion to full tasks (or
  nesting a task back down into a subtask)
- Drag-to-reschedule and drag-to-reorder, both backed by real server commands
- Google and email/password auth

## Tech Stack & Why

- **Django REST Framework** — I wanted the domain rules (what counts as a
  valid task, what a routine is allowed to do) enforced somewhere other than
  "whatever the frontend happens to send." DRF's serializer layer plus a thin
  services layer gave me one place to put that.
- **Next.js as a BFF, not just a frontend** — the browser never sees a JWT.
  Next's route handlers hold the access/refresh tokens in HTTP-only cookies
  and attach them server-side on the way to Django. It's more moving parts
  than "just fetch from Django," but it's the difference between "no XSS can
  steal a session token" and "hope no XSS ever happens."
- **Oracle Autonomous Database in production, SQLite for local dev** — mostly
  because Oracle is what I actually work with day to day, and I wanted a
  project where I'd hit its real quirks (and I did — see below).

## Architecture & Flow

`Browser → Next.js App Router (pages + BFF routes) → Django REST API → Postgres/Oracle`

Task edits don't go straight to a dumb `PUT`. Anything that changes the
*shape* of the task graph — nesting a task into a subtask, promoting a
subtask back out, detaching an occurrence from its routine, rescheduling,
reordering — goes through a dedicated command endpoint
(`/api/tasks/{id}/commands/<verb>/`) that takes a version number and fails
with a 409 if the version's stale. The frontend keeps an optimistic local
copy, queues the mutation, and reconciles against whatever the server
actually returns — including rebasing a still-in-flight edit on top of a
newer server state instead of just clobbering it.

## Design Decisions (this is the part I actually want people to read)

- **I made every task and category mutation optimistic-concurrency-controlled
  instead of "last write wins."** Early on I didn't — it was a personal
  to-do app, who's racing themselves? Then I found a real case: rename a
  category on one tab while a background sync is mid-flight on another, and
  you can silently end up with two categories that only differ by
  capitalization. That one bug is the reason the whole task-mutation surface
  is now versioned commands instead of generic PUTs.
- **I keep a running log of every bug I find and fix, with the reasoning,
  not just the diff.** `docs/refining/` is a numbered register (RF-001
  through RF-020 so far) — things like a TOCTOU race in category uniqueness
  that I closed with a real database constraint instead of trusting the app
  layer alone, and an auth-throttle interaction where a burst of failed
  logins from one IP could accidentally lock out the *entire* login endpoint
  for everyone, not just that IP. I'd rather show the list of things that
  were wrong and how I fixed them than pretend the first version was right.
- **I split validation across two layers on purpose, and wrote down which
  rules live where and why.** Some domain rules (a bucket-scoped task
  needing a category, a repeating task and a routine-generated occurrence
  being mutually exclusive) are DB `CHECK` constraints, because I wanted
  them to hold even if something bypasses the API someday. Others only make
  sense as serializer-level logic (regex-shaped fields, cross-field rules
  that touch a JSON blob) because a portable constraint can't express them.

## Result

It's the app I actually use every day to plan my week — not a portfolio
piece I built and abandoned. The commit history is mostly incremental
feature work, but a meaningful chunk of it is me going back in after
something shipped, finding a real bug or a race condition, and fixing it
properly instead of patching around it. That loop — ship, find what's
actually wrong, fix the root cause, write down why — is closer to how I want
to work professionally than a features list is.

## Gallery

TODO — screenshots of the weekly view, the task detail drawer, and the new
subtask detail panel once you've got a few good ones.

---

## Notes for the actual conversation (not part of the draft copy above)

Things I deliberately left out or softened, since you can push back on any
of these:

- I didn't name the specific employer (ComGen) or claim this project is
  "production" — it's a personal project, and I kept the language honest
  about that while still making the engineering depth obvious.
- The "Design Decisions" section leans on RF-007 (category race) and RF-018
  (auth lockout bug) as the two concrete stories, since those are the
  clearest "found a real bug, fixed it at the right layer" narratives in the
  register. Happy to swap in different ones if you'd rather highlight RF-005
  (the transactional command system) or RF-009 (auth hardening) more
  directly instead of as background.
- I didn't mention today's Subtask Detail panel / focus-trap work — it's
  real and recent, but felt like a smaller UI detail next to the backend
  stories above. Could add a line if you want the write-up to feel current.
- Tone check: I aimed for "engineer explaining their own project to another
  engineer," not resume-speak. Tell me if any paragraph still reads stiff.
