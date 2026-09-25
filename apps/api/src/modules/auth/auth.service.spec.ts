import { AuthService } from './auth.service';

describe('AuthService password reset logging', () => {
  const email = 'reviewer@example.test';
  const resetLink =
    'https://example.test/reset?mode=resetPassword&oobCode=secret-bearer-token';

  let service: AuthService;
  let emailService: { sendPasswordResetEmail: jest.Mock };
  let logger: { error: jest.Mock };

  beforeEach(() => {
    const firebaseService = {
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'firebase-user-1',
          displayName: 'Test Driver',
        }),
        generatePasswordResetLink: jest.fn().mockResolvedValue(resetLink),
      },
    };
    const usersRepository = {
      findById: jest.fn().mockResolvedValue({ displayName: 'Test Driver' }),
    };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'firebase.apiKey' ? 'test-api-key' : undefined,
      ),
    };
    emailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(false),
    };
    logger = { error: jest.fn() };

    service = new AuthService(
      firebaseService as never,
      usersRepository as never,
      configService as never,
      emailService as never,
      {} as never,
      {} as never,
      logger as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not expose the reset link when email delivery returns false', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sendPasswordReset(email)).resolves.toEqual({
      success: true,
      message: 'If the email exists, a password reset link has been sent',
    });

    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      email,
      'Test Driver',
      resetLink,
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Password reset email delivery failed',
      undefined,
      AuthService.name,
    );

    const emittedLogs = JSON.stringify([
      logSpy.mock.calls,
      errorSpy.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(emittedLogs).not.toContain(resetLink);
    expect(emittedLogs).not.toContain('secret-bearer-token');
  });

  it('does not serialize arbitrary errors from the email sender', async () => {
    emailService.sendPasswordResetEmail.mockRejectedValue(new Error(resetLink));
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sendPasswordReset(email)).rejects.toThrow(
      'Failed to send password reset email',
    );

    expect(logger.error).toHaveBeenCalledWith(
      'Password reset request failed',
      undefined,
      AuthService.name,
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(resetLink);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(resetLink);
  });
});
