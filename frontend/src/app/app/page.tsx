import Link from "next/link";

import { LogoutButton } from "@/features/auth/components/logout-button";

export default function AppPage() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Picking Up</p>
          <h1>Task workspace</h1>
        </div>
        <LogoutButton />
      </header>

      <main className="app-main">
        <aside className="panel" aria-label="Task navigation">
          <nav>
            <ul className="nav-list">
              <li>
                <Link aria-current="page" href="/app">
                  Today
                </Link>
              </li>
              <li>
                <Link href="/app">Inbox</Link>
              </li>
              <li>
                <Link href="/app">Done</Link>
              </li>
              <li>
                <Link href="/app">Settings</Link>
              </li>
            </ul>
          </nav>
        </aside>

        <section className="panel">
          <p className="eyebrow">Protected route</p>
          <h2>Authorization shell is ready</h2>
          <p>
            This page is protected by an HTTP-only access token cookie. The task UI can be
            built here after the Django auth endpoints are available.
          </p>
        </section>
      </main>
    </div>
  );
}
