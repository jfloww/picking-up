"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Authentication failed.");
      }

      if (isLogin) {
        router.replace(searchParams.get("next") ?? "/app");
      } else {
        router.replace("/login");
      }

      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-form__header">
        <p className="eyebrow">{isLogin ? "Welcome back" : "Create workspace"}</p>
        <h1>{isLogin ? "Sign in to Picking Up" : "Create your account"}</h1>
        <p>
          {isLogin
            ? "Use your account to access your task workspace."
            : "This account will work for web now and iPhone later."}
        </p>
      </div>

      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>

      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Working..." : isLogin ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
