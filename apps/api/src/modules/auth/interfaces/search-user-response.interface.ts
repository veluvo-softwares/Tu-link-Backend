export interface SearchUserResult {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
}

export interface SearchUserResponse {
  users: SearchUserResult[];
  total: number;
}
