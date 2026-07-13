import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/features/auth/components/auth-form";

export default function SignupPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Suspense>
          <AuthForm mode="signup" />
        </Suspense>
        <p className="auth-card__footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
