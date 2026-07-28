import { ErrorPage } from "@/components/error-page";

export default function NotFound() {
  return (
    <ErrorPage
      title="Page not found"
      description="The page you're looking for doesn't exist or may have moved."
    />
  );
}
