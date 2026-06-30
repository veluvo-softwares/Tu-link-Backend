import { registerAs } from '@nestjs/config';

export default registerAs('firebase', () => ({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  apiKey: process.env.FIREBASE_API_KEY,
  // requestUri required by accounts:signInWithIdp. Defaults to the project's
  // Firebase auth domain; overridable for non-default custom domains.
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN ||
    (process.env.FIREBASE_PROJECT_ID
      ? `https://${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`
      : 'https://localhost'),
}));
