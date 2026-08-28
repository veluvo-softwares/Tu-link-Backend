import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <div style={{ padding: 48 }}>Sign-in will be enabled after Clerk is configured.</div>;
  }

  return (
    <main className="clerk-auth">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </main>
  );
}
