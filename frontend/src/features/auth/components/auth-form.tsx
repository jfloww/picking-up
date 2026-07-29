"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleSignInButton } from "./google-sign-in-button";

type AuthFormProps = {
  mode: "login" | "signup";
};

const inputClassName =
  "h-11 rounded-lg border-transparent bg-muted focus-visible:border-ring";

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    if (!isLogin && password !== String(formData.get("confirm-password") ?? "")) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
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
        router.replace(searchParams.get("next") ?? "/planner");
      } else {
        router.replace("/login");
      }

      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Authentication failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <h1 className="text-3xl font-extralight tracking-tight text-foreground">
        {isLogin ? "Sign in" : "Create account"}
      </h1>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email" className="text-subtle">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClassName}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password" className="text-subtle">
          Password
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
          className={inputClassName}
        />
      </div>

      {!isLogin ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password" className="text-subtle">
            Confirm password
          </Label>
          <Input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClassName}
          />
        </div>
      ) : null}

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
