import { registerAs } from '@nestjs/config';

export default registerAs('firebase', () => ({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  apiKey: process.env.FIREBASE_API_KEY,
}));
