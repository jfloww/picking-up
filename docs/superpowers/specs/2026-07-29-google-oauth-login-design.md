# Google OAuth Login — Design

## Goal

Let users sign in (and sign up) with their Google account, alongside the
existing email/password flow. Django remains the sole issuer of the app's
JWTs; Next.js remains the only thing that sets the httpOnly auth cookies.
No change to the existing email/password flow's behavior.

## Out of scope (this pass)

- Apple Sign In — a real, separate scope (paid Apple Developer Program
  enrollment, POST-based redirect callback, signed JWT client secret). Its
  own spec once you're ready to enroll.
- Any use of Google APIs beyond identity (no calendar/contacts/etc scopes).
- Full OAuth 2.0 Authorization Code redirect flow, and NextAuth.js/Auth.js —
  considered and rejected; see "Approaches considered" below.

## Architecture

```
Browser (GIS button)
  → gets a signed Google ID token client-side (no redirect, no state param)
  → POST /api/auth/google   (Next.js route, mirrors /api/auth/login)
     → POST /api/auth/google/  (Django)
        → verify ID token (sig, iss, aud, exp, email_verified)
        → resolve/create User + GoogleIdentity
        → issue Simple JWT pair (same as EmailTokenObtainPairSerializer)
     ← {access, refresh}
  ← sets httpOnly cookies, {ok: true}
```

## Approaches considered

1. **Google Identity Services (GIS) button + ID-token verification on
   Django (chosen).** Frontend renders Google's official button; on
   success the browser holds a signed ID token from Google directly — no
   redirect, no CSRF `state` param to manage (Google's SDK owns that
   popup's integrity). That token is POSTed to a new Django endpoint,
   verified, and exchanged for the app's own Simple JWT pair via the exact
   same issuance path the password flow already uses. Smallest surface:
   one backend endpoint, one small model, one frontend button. Fits the
   existing architecture exactly — Django stays the sole JWT authority,
   Next.js stays a thin cookie-setting proxy.
2. **Full server-side OAuth Authorization Code redirect flow in Django.**
   More "classic" OAuth, and would be needed if we ever wanted Django to
   call Google APIs on the user's behalf. Rejected: the cross-origin
   handoff is awkward here specifically because Next.js's route handlers
   — not Django — are what set the httpOnly cookies today. Django's
   callback would need a redirect-with-one-time-code just to bridge back
   to Next.js, adding a moving part for no benefit given we only need
   identity, not API access.
3. **NextAuth.js (Auth.js) on the frontend.** Batteries-included, easy to
   add more providers later. Rejected: means running it alongside — or
   migrating away from — the existing hand-rolled Simple JWT +
   httpOnly-cookie system that already works for email/password. Much
   bigger, riskier change than "add Google login."

## Backend

### New model: `apps/accounts/models.py::GoogleIdentity`

A separate table, not fields bolted onto `auth.User` (which this app
doesn't own):

```python
class GoogleIdentity(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="google_identity"
    )
    sub = models.CharField(max_length=255, unique=True)  # Google's stable subject id
    email = models.EmailField()  # snapshot at link time, for auditing — not the lookup key
    created_at = models.DateTimeField(auto_now_add=True)
```

Lookup for a returning Google user is always by `sub`, never by email —
once linked, a user changing their Google account's email later doesn't
orphan the link or create a duplicate account.

### Email uniqueness

Django's built-in `auth.User.email` has no DB-level unique constraint —
only the app-level check in `RegisterSerializer.validate_email`. The
account-linking behavior below depends on "one email → at most one user"
actually holding, so this needs a real constraint, not just the
application check. Verified against the live database first: 3 users, no
blank emails, no duplicate emails — safe to add directly, no data-cleanup
migration required.

Add a migration with `RunSQL` (reverse: `DROP INDEX`) creating a unique
index on `auth_user.email`. This is additive to the existing
`RegisterSerializer` check — defense-in-depth against races, not a
replacement for it.

### New endpoint: `POST /api/auth/google/`

`GoogleTokenObtainView`, `permission_classes = (AllowAny,)`:

1. **Verify the token.** `google.oauth2.id_token.verify_oauth2_token(credential, google.auth.transport.requests.Request(), audience=settings.GOOGLE_OAUTH_CLIENT_ID)`. This call validates signature, issuer (`accounts.google.com` / `https://accounts.google.com`), audience, and expiry, raising on failure — caught and turned into a 400. `email_verified` is **not** covered by that call and must be checked manually; reject (400) if it isn't `True`.
2. **Resolve the account**, in order:
   - `GoogleIdentity.objects.filter(sub=claims["sub"]).select_related("user").first()` → existing Google user. Done.
   - Else `User.objects.filter(email=claims["email"]).first()` → an existing password-based account with the same **verified** email → **auto-link**: create a `GoogleIdentity` row pointing at it. (This is the behavior you confirmed — matching email means matching account; Google sign-in becomes another way into the same account, tasks untouched.)
   - Else → new account: `User.objects.create_user(username=claims["email"], email=claims["email"])` — same `username = email` convention `RegisterSerializer.create()` already uses for password sign-up — then `set_unusable_password()` (Google-only account, no password to authenticate with directly), then a `GoogleIdentity` row.
3. **Issue tokens.** `RefreshToken.for_user(user)` — identical shape, lifetime, and rotation config to `EmailTokenObtainPairSerializer`. Response body: `{"access": ..., "refresh": ...}`.

Refresh (`/api/auth/token/refresh/`), logout/blacklist
(`/api/auth/logout/`), and `MeView` need **no changes** — they operate
purely on the issued token, with no awareness of how the user originally
authenticated.

### Origin check

This is a stateless JSON endpoint — auth comes from the POST body (a
Google-signed token), not from ambient cookies — so it isn't
classically CSRF-vulnerable the way cookie-authenticated form posts are.
As defense-in-depth anyway: the view rejects any request whose `Origin`
header is present but not in `DJANGO_CORS_ALLOWED_ORIGINS`. (A missing
Origin header — e.g. a same-origin non-browser test client — is allowed
through; only a *mismatched* Origin is rejected.)

The real first line of defense is a one-time manual setup step, not
application code: restricting "Authorized JavaScript origins" for the
OAuth client in Google Cloud Console to this app's actual origins. Called
out explicitly in the implementation plan's setup task.

### New settings / dependencies

- `GOOGLE_OAUTH_CLIENT_ID` — new Django setting, read from env, used as
  the `audience` in verification.
- New dependency: `google-auth` (provides `google.oauth2.id_token`).

## Frontend

- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — same client ID value as the backend
  setting, browser-exposed (required for the GIS button to initialize).
- New `GoogleSignInButton` component: loads Google's GIS script
  (`https://accounts.google.com/gsi/client`) and renders the official
  button. Used inside `AuthForm` in both `login` and `signup` modes —
  Google sign-in doubles as sign-up per the account-resolution logic
  above, so there's no separate "sign up with Google" code path.
- New route `frontend/src/app/api/auth/google/route.ts`, structurally
  identical to today's `login/route.ts`: takes `{ credential }`, calls a
  new `requestGoogleLogin(credential)` in `features/auth/api/auth.ts`
  (POSTs to Django's `/api/auth/google/`), sets cookies via the existing
  `setAuthCookies`, returns `{ ok: true }` on success or the error body on
  failure — same error-handling shape as `login/route.ts`.

## Testing

**Backend** (mocking `verify_oauth2_token`, no real network calls to
Google):
- New user: no existing `GoogleIdentity`, no existing `User` with that
  email → creates both, `set_unusable_password()` on the user, returns a
  valid token pair.
- Returning user: existing `GoogleIdentity` with matching `sub` → no new
  `User`/`GoogleIdentity` created, returns a valid token pair for the
  linked user.
- Existing-email conflict: no `GoogleIdentity` for this `sub`, but a
  `User` already exists with the claimed (verified) email → links a new
  `GoogleIdentity` to the *existing* user rather than creating a duplicate
  account.
- Invalid token: `verify_oauth2_token` raises → 400, no user/identity
  created.
- Wrong audience: verification raises due to audience mismatch → 400.
- Unverified email: token verifies but `email_verified` is `False` → 400,
  no user/identity created.
- Origin check: mismatched `Origin` header → rejected; missing `Origin` →
  allowed through.

**Frontend:** route/component wiring for the new button and the new
`/api/auth/google` route, matching the existing depth of coverage for
`AuthForm` and `login/route.ts` (mocked `credential` → mocked fetch to the
Django endpoint → cookie-setting assertions).

## Global constraints

- No change to the existing email/password flow's request/response shapes
  or behavior.
- `GoogleIdentity` lookup is always by `sub`; email is never used to
  identify a *returning* Google user, only to link a *new* Google sign-in
  to a pre-existing password account.
- Google-only accounts get `set_unusable_password()` — never a random
  throwaway password, so `authenticate()` with any password reliably
  fails for them.
- The unique index on `auth_user.email` is additive to, not a replacement
  for, `RegisterSerializer`'s existing application-level check.
- New users created via Google sign-in use `username = email`, matching
  `RegisterSerializer.create()`'s existing convention for password
  sign-up.
