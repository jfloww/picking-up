import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { AuthForm } from "@/features/auth/components/auth-form";

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="text-brand underline underline-offset-4">
          Create account
        </Link>
      </p>
    </AuthLayout>
  );
}
