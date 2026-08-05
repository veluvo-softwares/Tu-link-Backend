const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
];

/** Resolve trusted browser and Socket.IO origins from one setting. */
export function getAllowedOrigins(): string[] {
  const configured = (
    process.env.CORS_ORIGIN ??
    process.env.WS_CORS_ORIGIN ??
    ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0 && !configured.includes('*')) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGIN must contain explicit trusted origins in production',
    );
  }

  return LOCAL_DEVELOPMENT_ORIGINS;
}
