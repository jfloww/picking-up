# To-Do Platform First Plan

## Goal

Build a real-life to-do application that works well on desktop web first, supports small browser windows, can move to iPhone later, starts cheap, and can grow with disciplined engineering practices.

## Product Direction

The first version should focus on one daily workflow:

- Add a task quickly.
- See today's tasks.
- Mark tasks complete.
- Edit and delete tasks.
- Sign in and preserve data across browsers.
- Keep the interface fast, simple, and reliable.

Avoid advanced features at first, including teams, comments, AI, calendar integrations, recurring tasks, reminders, and sharing. Add those only after the basic product is useful in daily life.

## Recommended V1 Stack

- Frontend: Next.js, React, TypeScript.
- Backend: Django.
- API: Django REST Framework.
- Database: Oracle Database on OCI.
- Auth: Django auth with JWT tokens.
- Web hosting: Vercel.
- Backend hosting: Oracle Cloud Infrastructure Always Free VM.
- Mobile: Later phase. Start with responsive web, then PWA, then native iPhone only if needed.

## Initial Architecture

```text
Desktop browser / mobile browser later
        |
        v
Next.js app on Vercel
        |
        v
Django REST API
        |
        v
Oracle Database on OCI
```

## Development Phases

### Phase 1: Web Prototype

- Build UI with local mock data.
- Validate desktop and tablet layout.
- Support narrow browser windows.
- Create Today, Inbox, Done, Archived, and Settings screens.
- Add task detail panel.

### Phase 2: Django Backend

- Create Django project.
- Add Django REST Framework.
- Add accounts and tasks apps.
- Add JWT authentication.
- Add Oracle Database settings.
- Add task API endpoints.
- Add user-owned task permissions.

### Phase 3: Real Web App

- Connect frontend to Django API.
- Implement login and signup.
- Implement task create, read, update, delete.
- Deploy frontend to Vercel.
- Deploy backend to OCI.
- Use Oracle Database on OCI for production data.

### Phase 4: Production Quality

- Add backend permission tests.
- Add loading, empty, and error states.
- Add basic tests.
- Add simple analytics.
- Add export or backup path.

### Phase 5: Mobile Web / PWA

- Make app installable as a PWA.
- Add offline caching.
- Add push notifications if needed.
- Add recurring tasks after the core loop is proven.

### Phase 6: Native iPhone

Only consider React Native or Expo if the PWA is not enough for real usage.

## First Build Checklist

- [ ] Create Next.js app in `frontend`.
- [ ] Add TypeScript and linting.
- [ ] Build web-first app shell.
- [ ] Build task list UI with mock data.
- [ ] Build task create/edit/delete interactions.
- [ ] Create Django backend project in `backend`.
- [ ] Add Django REST Framework.
- [ ] Add JWT auth.
- [ ] Add Oracle Database settings.
- [ ] Add task API.
- [ ] Add backend permissions.
- [ ] Connect UI to Django API.
- [ ] Deploy frontend to Vercel.
- [ ] Deploy Django backend to OCI.
- [ ] Connect Django backend to Oracle Database.
- [ ] Use personally for 7 days.
