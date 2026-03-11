export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/((?!login|api/auth|api/import-file|api/import-blob|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
