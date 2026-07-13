import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/features/auth/components/auth-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
        <p className="auth-card__footer">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
