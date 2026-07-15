import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { AuthForm } from "@/features/auth/components/auth-form";

export default function SignupPage() {
  return (
    <AuthLayout>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-brand underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
