# Google OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users sign in (and sign up) with Google, alongside the existing email/password flow, without changing that flow's behavior.

**Architecture:** A Google Identity Services (GIS) button on the frontend gets a signed ID token straight from Google (no redirect, no CSRF `state` param needed). That token is POSTed to a new Django endpoint, which verifies it, finds-or-creates a `User` + a new `GoogleIdentity` link row, and issues the exact same Simple JWT pair the password flow already issues. Next.js proxies it through a new route that sets the same httpOnly cookies as today's login route.

**Tech Stack:** Django 5 / DRF / djangorestframework-simplejwt (existing), `google-auth` (new backend dependency), Next.js 15 App Router / React 19 (existing), Google's `accounts.google.com/gsi/client` script (new, loaded via `next/script`, no npm dependency).

## Global Constraints

- No change to the existing email/password flow's request/response shapes or behavior — `EmailTokenObtainPairView`, `RegisterView`, `LogoutView`, `TokenRefreshView`, `MeView` are untouched.
- `GoogleIdentity` lookup for a *returning* user is always by `sub` (Google's stable subject id), never by email.
- Google-only accounts get an explicit `user.set_unusable_password()` call (not just an implicit `create_user(password=None)`).
- The new unique index on `auth_user.email` is additive to, not a replacement for, `RegisterSerializer.validate_email`'s existing application-level check.
- New users created via Google sign-in use `username = email`, matching `RegisterSerializer.create()`'s existing convention.
- New Django endpoint returns errors as `{"error": "<message>"}` (not DRF's default serializer-validation shape), because the frontend's `readErrorMessage()` (`frontend/src/lib/api/server.ts`) only recognizes `data.detail` or `data.error` — matching the shape `LogoutView` already uses.
- Apple Sign In, full OAuth Authorization Code redirect flow, and NextAuth.js are explicitly out of scope (see spec's "Approaches considered").
- **Known environment quirk, unrelated to this feature:** this machine's `backend/.env`/`.env.development` point Django at the live Oracle database, and that Oracle user lacks privileges to create Django's throwaway test database (`ORA-01031: insufficient privileges`). This is a pre-existing, already-tracked gap (see `docs/planning/6. oracle-database.md`'s unchecked "Run auth tests against Oracle Database" item) — not something this plan fixes. Every backend test step in this plan therefore runs with the Oracle env vars blanked out for that one command, which is confirmed to fall back to an in-memory SQLite test database:
  ```bash
  cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.accounts -v 2
  ```
  Do not edit `.env`/`.env.development` to work around this — the inline env override is scoped to the single test command and leaves the actual dev environment untouched.

---

### Task 1: `GoogleIdentity` model, email uniqueness, settings, dependency

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/accounts/migrations/0001_initial.py`
- Create: `backend/apps/accounts/migrations/0002_unique_user_email.py`
- Modify: `backend/config/settings.py`
- Modify: `backend/.env.example`
- Modify: `backend/apps/accounts/tests.py`

**Interfaces:**
- Produces: `apps.accounts.models.GoogleIdentity` — fields `user` (OneToOne to `settings.AUTH_USER_MODEL`, `related_name="google_identity"`), `sub` (`CharField`, unique), `email` (`EmailField`), `created_at` (`DateTimeField`, auto). Task 2 imports and uses this model directly.
- Produces: `settings.GOOGLE_OAUTH_CLIENT_ID` — Django setting, read from env, `None` if unset. Task 2 passes this as the `audience` when verifying tokens.
- Produces: a DB-level unique index on `auth_user.email` (name: `unique_auth_user_email`). No Python-level interface — enforced only as an `IntegrityError` on duplicate insert/update.

- [ ] **Step 1: Write the failing model test**

Append to `backend/apps/accounts/tests.py` (add these imports at the top alongside the existing ones, and this new test class at the end of the file):

```python
from django.db import IntegrityError, transaction

from apps.accounts.models import GoogleIdentity


class GoogleIdentityModelTests(TestCase):
    def test_sub_must_be_unique(self):
        user_a = User.objects.create_user(username="a@example.com", email="a@example.com")
        user_b = User.objects.create_user(username="b@example.com", email="b@example.com")
        GoogleIdentity.objects.create(user=user_a, sub="dup-sub", email="a@example.com")

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GoogleIdentity.objects.create(user=user_b, sub="dup-sub", email="b@example.com")

    def test_user_email_must_be_unique_at_the_database_level(self):
        User.objects.create_user(username="a@example.com", email="dup@example.com")

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(username="b@example.com", email="dup@example.com")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.accounts.tests.GoogleIdentityModelTests -v 2`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` for `apps.accounts.models.GoogleIdentity` (the model doesn't exist yet).

- [ ] **Step 3: Add the dependency**

In `backend/requirements.txt`, add these two lines after `oracledb>=3.0,<4.0`:

```
google-auth>=2.35,<3.0
requests>=2.32,<3.0
```

`google.auth.transport.requests` (used in Task 2) imports the `requests`
package directly — `google-auth` does not pull it in as a transitive
dependency, and nothing else in this file does either. Confirmed missing
in this backend's venv before adding it here (`import requests` raised
`ModuleNotFoundError`).

Run: `cd backend && pip install -r requirements.txt`

- [ ] **Step 4: Write the model**

Replace the entire contents of `backend/apps/accounts/models.py` with:

```python
from django.conf import settings
from django.db import models


# Django's built-in User model remains the account record for V1 — no
# custom AUTH_USER_MODEL. Google-specific fields live on a related model
# instead, since the built-in User can't be extended directly.
class GoogleIdentity(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="google_identity"
    )
    sub = models.CharField(max_length=255, unique=True)
    email = models.EmailField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"GoogleIdentity(user_id={self.user_id}, sub={self.sub})"
```

- [ ] **Step 5: Write the migrations**

Create `backend/apps/accounts/migrations/0001_initial.py`:

```python
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GoogleIdentity',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sub', models.CharField(max_length=255, unique=True)),
                ('email', models.EmailField(max_length=254)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='google_identity', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
```

Create `backend/apps/accounts/migrations/0002_unique_user_email.py`. This adds a real DB constraint on a model this app doesn't own (`auth.User`), so it's `RunSQL` rather than `AddField`/`AlterField` — Django's migration *state* doesn't need to know about it, only the database does:

```python
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql="CREATE UNIQUE INDEX unique_auth_user_email ON auth_user (email)",
            reverse_sql="DROP INDEX unique_auth_user_email",
        ),
    ]
```

- [ ] **Step 6: Add the setting**

In `backend/config/settings.py`, find this block (near the other `ORACLE_DB_*` env reads, around line 78-80):

```python
ORACLE_DB_USER = env("ORACLE_DB_USER", default=None)
ORACLE_DB_PASSWORD = env("ORACLE_DB_PASSWORD", default=None)
ORACLE_DB_DSN = env("ORACLE_DB_DSN", default=None)
```

Directly below the `SIMPLE_JWT = {...}` block (around line 133-139), add:

```python
# Server-side audience check for Google Sign-In ID tokens. Unset in dev
# until a real OAuth client is created in Google Cloud Console.
GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID", default=None)
```

- [ ] **Step 7: Document the new env var**

In `backend/.env.example`, add after the `DJANGO_CORS_ALLOWED_ORIGINS=...` line:

```
# Google Sign-In. Create an OAuth 2.0 Client ID (Web application) in Google
# Cloud Console; restrict "Authorized JavaScript origins" to this app's
# actual origins (e.g. http://localhost:10050 for local dev, the Vercel
# domain for production) — that origin restriction, configured in the
# console, is the primary defense against a forged sign-in from another
# site, not application code.
# GOOGLE_OAUTH_CLIENT_ID=
```

- [ ] **Step 8: Run migrations, then run the tests to verify they pass**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py migrate`
Expected: applies `accounts.0001_initial` and `accounts.0002_unique_user_email` cleanly against the SQLite test/dev fallback.

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.accounts -v 2`
Expected: PASS — all tests in `apps/accounts/tests.py`, including the two new `GoogleIdentityModelTests`.

- [ ] **Step 9: Commit**

```bash
git add backend/requirements.txt backend/apps/accounts/models.py backend/apps/accounts/migrations/0001_initial.py backend/apps/accounts/migrations/0002_unique_user_email.py backend/config/settings.py backend/.env.example backend/apps/accounts/tests.py
git commit -m "feat: add GoogleIdentity model and a DB-level unique constraint on User.email"
```

---

### Task 2: `POST /api/auth/google/` — token verification and account resolution

**Files:**
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/config/urls.py`
- Modify: `backend/apps/accounts/tests.py`

**Interfaces:**
- Consumes: `apps.accounts.models.GoogleIdentity` (Task 1), `settings.GOOGLE_OAUTH_CLIENT_ID` (Task 1).
- Produces: `apps.accounts.views.GoogleTokenObtainView` — a DRF `APIView` handling `POST`. Request body: `{"credential": "<google-id-token>"}`. Success (200): `{"access": "<jwt>", "refresh": "<jwt>"}` — identical shape to `EmailTokenObtainPairView`. Failure (400/403): `{"error": "<message>"}`. Wired at `api/auth/google/`. Task 3 (frontend) calls this URL directly.

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/accounts/tests.py` — add `from unittest.mock import patch` and `from django.conf import settings` to the imports at the top, and this new test class at the end of the file:

```python
class GoogleAuthApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _claims(self, **overrides):
        claims = {
            "sub": "google-sub-123",
            "email": "jane@example.com",
            "email_verified": True,
        }
        claims.update(overrides)
        return claims

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_new_user_created_with_unusable_password(self, mock_verify):
        mock_verify.return_value = self._claims()

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        user = User.objects.get(email="jane@example.com")
        self.assertFalse(user.has_usable_password())
        self.assertTrue(GoogleIdentity.objects.filter(user=user, sub="google-sub-123").exists())

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_returning_google_user_does_not_duplicate_identity(self, mock_verify):
        mock_verify.return_value = self._claims()
        user = User.objects.create_user(username="jane@example.com", email="jane@example.com")
        GoogleIdentity.objects.create(user=user, sub="google-sub-123", email="jane@example.com")

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(GoogleIdentity.objects.filter(sub="google-sub-123").count(), 1)
        access_token = response.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        me_response = self.client.get("/api/auth/me/")
        self.assertEqual(me_response.data["email"], "jane@example.com")

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_existing_password_account_gets_linked_by_email(self, mock_verify):
        mock_verify.return_value = self._claims()
        existing = User.objects.create_user(
            username="jane@example.com", email="jane@example.com", password="StrongPass123!"
        )

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(User.objects.filter(email="jane@example.com").count(), 1)
        identity = GoogleIdentity.objects.get(sub="google-sub-123")
        self.assertEqual(identity.user_id, existing.id)
        existing.refresh_from_db()
        self.assertTrue(existing.has_usable_password())  # linking never touches the existing password

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_invalid_token_is_rejected(self, mock_verify):
        mock_verify.side_effect = ValueError("Invalid token signature")

        response = self.client.post("/api/auth/google/", {"credential": "bad-token"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_wrong_audience_is_rejected(self, mock_verify):
        mock_verify.side_effect = ValueError("Token has wrong audience")

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 400)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_verifies_token_against_the_configured_audience(self, mock_verify):
        mock_verify.return_value = self._claims()

        self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        args, kwargs = mock_verify.call_args
        self.assertEqual(args[0], "token")
        self.assertEqual(kwargs["audience"], settings.GOOGLE_OAUTH_CLIENT_ID)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_unverified_email_is_rejected(self, mock_verify):
        mock_verify.return_value = self._claims(email_verified=False)

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_mismatched_origin_is_rejected(self, mock_verify):
        mock_verify.return_value = self._claims()

        response = self.client.post(
            "/api/auth/google/",
            {"credential": "token"},
            format="json",
            HTTP_ORIGIN="https://evil.example.com",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(User.objects.count(), 0)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_matching_origin_is_allowed(self, mock_verify):
        mock_verify.return_value = self._claims()

        response = self.client.post(
            "/api/auth/google/",
            {"credential": "token"},
            format="json",
            HTTP_ORIGIN=settings.CORS_ALLOWED_ORIGINS[0],
        )

        self.assertEqual(response.status_code, 200)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_missing_credential_is_rejected(self, mock_verify):
        response = self.client.post("/api/auth/google/", {}, format="json")

        self.assertEqual(response.status_code, 400)
        mock_verify.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.accounts.tests.GoogleAuthApiTests -v 2`
Expected: FAIL — `404` responses (`api/auth/google/` isn't wired up yet) and `AttributeError` for `apps.accounts.views.google_id_token` (doesn't exist yet).

- [ ] **Step 3: Write the view**

In `backend/apps/accounts/views.py`, add these imports at the top (alongside the existing ones):

```python
from django.conf import settings
from django.contrib.auth import get_user_model
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from .models import GoogleIdentity
```

Add this at the bottom of the file:

```python
User = get_user_model()


class GoogleTokenObtainView(APIView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request):
        origin = request.headers.get("Origin")
        if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
            return Response({"error": "Invalid origin."}, status=status.HTTP_403_FORBIDDEN)

        credential = request.data.get("credential")
        if not credential:
            return Response({"error": "Missing Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            claims = google_id_token.verify_oauth2_token(
                credential, google_requests.Request(), audience=settings.GOOGLE_OAUTH_CLIENT_ID
            )
        except ValueError:
            return Response({"error": "Invalid Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        if not claims.get("email_verified"):
            return Response({"error": "Google email is not verified."}, status=status.HTTP_400_BAD_REQUEST)

        sub = claims["sub"]
        email = claims["email"].strip().lower()

        identity = GoogleIdentity.objects.select_related("user").filter(sub=sub).first()
        if identity is not None:
            user = identity.user
        else:
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(username=email, email=email)
                user.set_unusable_password()
                user.save(update_fields=["password"])
            GoogleIdentity.objects.create(user=user, sub=sub, email=email)

        refresh = RefreshToken.for_user(user)

        return Response(
            {"access": str(refresh.access_token), "refresh": str(refresh)},
            status=status.HTTP_200_OK,
        )
```

- [ ] **Step 4: Wire the URL**

In `backend/config/urls.py`, change:

```python
from apps.accounts.views import EmailTokenObtainPairView, LogoutView, MeView, RegisterView
```

to:

```python
from apps.accounts.views import EmailTokenObtainPairView, GoogleTokenObtainView, LogoutView, MeView, RegisterView
```

Add this line to `urlpatterns`, directly after the `api/auth/token/` line:

```python
    path("api/auth/google/", GoogleTokenObtainView.as_view(), name="google_token_obtain"),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.accounts -v 2`
Expected: PASS — all tests in the file, including every new `GoogleAuthApiTests` case.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounts/views.py backend/config/urls.py backend/apps/accounts/tests.py
git commit -m "feat: add POST /api/auth/google/ for Google Sign-In token verification"
```

---

### Task 3: Next.js proxy route (`/api/auth/google`)

**Files:**
- Modify: `frontend/src/features/auth/api/auth.ts`
- Create: `frontend/src/app/api/auth/google/route.ts`
- Create: `frontend/src/app/api/auth/google/route.test.ts`

**Interfaces:**
- Consumes: Django's `POST api/auth/google/` (Task 2) — request `{"credential": "..."}`, success response `{"access": "...", "refresh": "..."}`.
- Consumes: `apiRequest` (`frontend/src/lib/api/server.ts`), `setAuthCookies` (`frontend/src/lib/auth/cookies.ts`) — both existing, unchanged.
- Produces: `requestGoogleLogin(credential: string): Promise<TokenPair>` in `frontend/src/features/auth/api/auth.ts`. Task 4 does not call this directly — it POSTs to the route below instead, matching how `AuthForm` calls `/api/auth/login` rather than `requestLogin` directly.
- Produces: `POST /api/auth/google` Next.js route. Request body: `{"credential": "<google-id-token>"}`. Success (200): `{"ok": true}`, sets `access_token`/`refresh_token` httpOnly cookies. Failure: `{"error": "<message>"}`, status passed through from `apiRequest`'s thrown error — this route always responds 400 on any thrown error, matching `login/route.ts`'s existing behavior exactly.

- [ ] **Step 1: Write the failing route test**

Create `frontend/src/app/api/auth/google/route.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("POST /api/auth/google", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets auth cookies and returns ok on a successful Google sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ access: "access-token", refresh: "refresh-token" })),
    );

    const request = new NextRequest("http://localhost/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: "google-id-token" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.cookies.get("access_token")?.value).toBe("access-token");
    expect(response.cookies.get("refresh_token")?.value).toBe("refresh-token");
  });

  it("returns the error message and sets no cookies when Django rejects the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid Google credential." }, 400)),
    );

    const request = new NextRequest("http://localhost/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: "bad-token" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Google credential." });
    expect(response.cookies.get("access_token")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/app/api/auth/google/route.test.ts`
Expected: FAIL — cannot find module `./route` (doesn't exist yet).

- [ ] **Step 3: Add `requestGoogleLogin`**

In `frontend/src/features/auth/api/auth.ts`, add this function after `requestLogin`:

```typescript
export function requestGoogleLogin(credential: string) {
  return apiRequest<TokenPair>("/api/auth/google/", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}
```

- [ ] **Step 4: Write the route handler**

Create `frontend/src/app/api/auth/google/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import { setAuthCookies } from "@/lib/auth/cookies";
import { requestGoogleLogin } from "@/features/auth/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { credential } = await request.json();
    const tokens = await requestGoogleLogin(credential);
    const response = NextResponse.json({ ok: true });

    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google sign-in failed." },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/app/api/auth/google/route.test.ts`
Expected: PASS — both tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/auth/api/auth.ts frontend/src/app/api/auth/google/route.ts frontend/src/app/api/auth/google/route.test.ts
git commit -m "feat: add Next.js proxy route for Google Sign-In"
```

---

### Task 4: `GoogleSignInButton` and `AuthForm` wiring

**Files:**
- Create: `frontend/src/features/auth/components/google-sign-in-button.tsx`
- Create: `frontend/src/features/auth/components/google-sign-in-button.test.tsx`
- Modify: `frontend/src/features/auth/components/auth-form.tsx`
- Modify: `frontend/.env.example`
- Modify: `frontend/.env.development` (only if it exists and already lists non-secret public config — see Step 6)

**Interfaces:**
- Consumes: `POST /api/auth/google` (Task 3).
- Produces: `GoogleSignInButton` — a client component with no props, rendered inside `AuthForm`. Exports `submitGoogleCredential(credential: string): Promise<{ ok: true } | { ok: false; error: string }>` for direct testing without needing to simulate the full Google script/DOM flow.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/features/auth/components/google-sign-in-button.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/script", () => ({
  default: ({ onLoad }: { onLoad?: () => void }) => {
    onLoad?.();
    return null;
  },
}));

import { GoogleSignInButton, submitGoogleCredential } from "./google-sign-in-button";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("submitGoogleCredential", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok on a successful sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));

    expect(await submitGoogleCredential("id-token")).toEqual({ ok: true });
  });

  it("returns the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid Google credential." }, 400)));

    expect(await submitGoogleCredential("id-token")).toEqual({
      ok: false,
      error: "Invalid Google credential.",
    });
  });
});

describe("GoogleSignInButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { google?: unknown }).google;
    replaceMock.mockClear();
    refreshMock.mockClear();
  });

  it("initializes GIS with the configured client id and renders the button", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };

    render(<GoogleSignInButton />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(initialize.mock.calls[0][0]).toMatchObject({ client_id: "test-client-id" });
    expect(renderButton).toHaveBeenCalledTimes(1);
  });

  it("redirects on a successful credential callback", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };

    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0];
    await callback({ credential: "id-token" });

    expect(replaceMock).toHaveBeenCalledWith("/planner");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows an error and does not redirect when the callback fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid Google credential." }, 400)));
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };

    render(<GoogleSignInButton />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0];
    await callback({ credential: "bad-token" });

    await screen.findByText("Invalid Google credential.");
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/auth/components/google-sign-in-button.test.tsx`
Expected: FAIL — cannot find module `./google-sign-in-button` (doesn't exist yet).

- [ ] **Step 3: Write the component**

Create `frontend/src/features/auth/components/google-sign-in-button.tsx`:

```tsx
"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertTitle } from "@/components/ui/alert";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme: string; size: string; width?: number },
          ) => void;
        };
      };
    };
  }
}

export async function submitGoogleCredential(
  credential: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : "Google sign-in failed.",
    };
  }

  return { ok: true };
}

export function GoogleSignInButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!scriptLoaded || !clientId || !window.google || !containerRef.current) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        setError(undefined);
        const result = await submitGoogleCredential(response.credential);

        if (!result.ok) {
          setError(result.error);
          return;
        }

        router.replace(searchParams.get("next") ?? "/planner");
        router.refresh();
      },
    });
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      width: 320,
    });
  }, [scriptLoaded, router, searchParams]);

  return (
    <div className="flex flex-col items-center gap-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      <div ref={containerRef} />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `AuthForm`**

In `frontend/src/features/auth/components/auth-form.tsx`, add this import at the top:

```typescript
import { Separator } from "@/components/ui/separator";
import { GoogleSignInButton } from "./google-sign-in-button";
```

Add this directly after the closing `</form>` tag's content, i.e. change the component's return statement from ending with:

```tsx
      <Button
        type="submit"
        disabled={isSubmitting}
        size="lg"
        className="mt-1 w-full rounded-full"
      >
        {isSubmitting ? "Working..." : isLogin ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
```

to:

```tsx
      <Button
        type="submit"
        disabled={isSubmitting}
        size="lg"
        className="mt-1 w-full rounded-full"
      >
        {isSubmitting ? "Working..." : isLogin ? "Sign in" : "Create account"}
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <GoogleSignInButton />
    </form>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/auth/components/google-sign-in-button.test.tsx`
Expected: PASS — all four tests.

Run: `cd frontend && npx vitest run`
Expected: PASS — full suite, including the pre-existing `AuthForm`-adjacent tests (`logout-button.test.tsx`, `auth.test.ts`), confirming the wiring didn't break anything.

- [ ] **Step 6: Document the new env var**

In `frontend/.env.example`, add after `NEXT_PUBLIC_APP_NAME=Picking Up`:

```
# Same Google OAuth Client ID as backend/.env's GOOGLE_OAUTH_CLIENT_ID — this
# one is intentionally public (NEXT_PUBLIC_*), since the GIS button runs in
# the browser. Google enforces the actual security boundary by restricting
# "Authorized JavaScript origins" for this client ID in Cloud Console.
# NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

Check whether `frontend/.env.development` exists and already contains a real (non-empty) `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or other Google-related value — if it does not, leave it untouched; the app must run correctly with this var unset (`GoogleSignInButton` simply never calls `initialize`/`renderButton` in that case, per Step 3's `!clientId` guard), since no real Google Cloud OAuth client exists yet.

- [ ] **Step 7: Run the whole frontend suite and typecheck once more**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/auth/components/google-sign-in-button.tsx frontend/src/features/auth/components/google-sign-in-button.test.tsx frontend/src/features/auth/components/auth-form.tsx frontend/.env.example
git commit -m "feat: add Google Sign-In button to the login/signup form"
```

---

## Manual setup required before this works end-to-end (not part of any task above)

These are Google Cloud Console steps, not code — call them out to your human partner rather than attempting them as an implementation task:

1. Create an OAuth 2.0 Client ID (Web application type) in Google Cloud Console.
2. Restrict "Authorized JavaScript origins" to this app's real origins (local dev port, and the production Vercel domain once deployed) — this is the actual security boundary discussed in the design spec's Origin-check section, not the backend's `Origin`-header check, which is defense-in-depth on top of it.
3. Set `GOOGLE_OAUTH_CLIENT_ID` in `backend/.env`/`.env.development` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `frontend/.env.development` (or Vercel's project env vars for production) to that client ID.

Without this, all four tasks above are still fully buildable and testable (every test mocks the verification/GIS calls directly), but the button won't do anything real in a live browser until the client ID exists.
