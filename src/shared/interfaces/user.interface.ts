export interface User {
  id: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  isGuest?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
