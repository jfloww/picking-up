# Route Map

Routing uses Next.js 15 App Router under `frontend/src/app`. All pages inherit `frontend/src/app/layout.tsx`, global CSS, Geist, and the dark-first `ThemeProvider`.

| URL | Route file | Shared layout / shell | Summary |
| --- | --- | --- | --- |
| `/` | `frontend/src/app/page.tsx` | RootLayout, SiteHeader, SiteFooter | Marketing home with a task mock and auth-aware CTA. |
| `/app` | `frontend/src/app/app/page.tsx` | RootLayout, SiteHeader, SiteFooter | Main task calendar with Daily, Weekly, Monthly, and Yearly views. |
| `/login` | `frontend/src/app/login/page.tsx` | RootLayout, AuthLayout | Login form and signup link. |
| `/signup` | `frontend/src/app/signup/page.tsx` | RootLayout, AuthLayout | Registration form and login link. |
| `/api/auth/login` | `frontend/src/app/api/auth/login/route.ts` | API route | Auth login proxy and cookie setup. |
| `/api/auth/logout` | `frontend/src/app/api/auth/logout/route.ts` | API route | Logout and cookie cleanup. |
| `/api/auth/me` | `frontend/src/app/api/auth/me/route.ts` | API route | Current-user endpoint. |
| `/api/auth/register` | `frontend/src/app/api/auth/register/route.ts` | API route | Registration proxy. |

## Root layout source

```tsx
import type { Metadata } from "next";

import "./globals.css";
import { Geist } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Picking Up",
  description: "A practical task workspace for web first and iPhone later.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```
