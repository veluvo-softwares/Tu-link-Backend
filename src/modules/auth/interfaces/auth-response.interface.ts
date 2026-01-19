export interface AuthResponse {
  user: {
    uid: string;
    email: string;
    displayName: string;
    phoneNumber?: string;
    emailVerified?: boolean;
  };
  tokens: {
    idToken: string; // Changed from customToken to idToken for clarity
    refreshToken: string;
    expiresIn: number;
  };
}

export interface TokenRefreshResponse {
  idToken: string; // Changed from customToken to idToken for clarity
  refreshToken: string;
  expiresIn: number;
}
