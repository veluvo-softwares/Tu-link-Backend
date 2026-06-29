import { IsIn, IsString, IsOptional, ValidateIf } from 'class-validator';

export class SocialLoginDto {
  @IsIn(['google', 'apple'], {
    message: "provider must be one of: 'google', 'apple'",
  })
  provider: 'google' | 'apple';

  // Provider OIDC id token obtained on-device via the native SDK.
  @IsString()
  idToken: string;

  // Raw (unhashed) nonce. Required for Apple: Firebase recomputes
  // sha256(rawNonce) and matches it against the token's nonce claim.
  @ValidateIf((o: SocialLoginDto) => o.provider === 'apple')
  @IsString()
  nonce?: string;

  // Apple returns the user's name only on the FIRST authorization, so the
  // client forwards it here for the invariant-A upsert.
  @IsOptional()
  @IsString()
  displayName?: string;
}
