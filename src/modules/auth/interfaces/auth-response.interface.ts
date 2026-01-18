export interface AuthResponse {
  user: {
    uid: string;
    email: string;
    displayName: string;
    phoneNumber?: string;
    emailVerified?: boolean;
  };
  tokens: {
    customToken: string;
    expiresIn: number;
  };
}

export interface TokenRefreshResponse {
  customToken: string;
  expiresIn: number;
}
