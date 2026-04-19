export interface VerificationResponse {
  success: boolean;
  message: string;
}

export interface EmailVerificationResponse extends VerificationResponse {
  emailVerified?: boolean;
}
