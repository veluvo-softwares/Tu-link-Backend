import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <div style={{ padding: 48 }}>Sign-up will be enabled after Clerk is configured.</div>;
  }

  return (
    <main className="clerk-auth">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  );
}
