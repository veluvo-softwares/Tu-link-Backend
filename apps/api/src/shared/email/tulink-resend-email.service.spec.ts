import { TuLinkResendEmailService } from './tulink-resend-email.service';

describe('TuLinkResendEmailService failure logging', () => {
  const resetLink =
    'https://example.test/reset?mode=resetPassword&oobCode=secret-bearer-token';

  afterEach(() => jest.restoreAllMocks());

  it.each(['provider error result', 'provider exception'])(
    'does not log provider details for a %s',
    async (failureMode) => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const logSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      const service = new TuLinkResendEmailService({
        get: (key: string, fallback?: string) =>
          key === 'RESEND_API_KEY' ? 'test-api-key' : fallback,
      } as never);
      const send = jest.fn().mockImplementation(() => {
        if (failureMode === 'provider exception') {
          return Promise.reject(new Error(resetLink));
        }
        return Promise.resolve({ data: null, error: new Error(resetLink) });
      });

      (
        service as unknown as {
          resend: { emails: { send: jest.Mock } };
        }
      ).resend = { emails: { send } };

      await expect(
        service.sendEmail({
          to: 'reviewer@example.test',
          subject: 'Password reset',
          html: `<a href="${resetLink}">Reset</a>`,
        }),
      ).resolves.toBe(false);

      const emittedLogs = JSON.stringify([
        errorSpy.mock.calls,
        logSpy.mock.calls,
      ]);
      expect(emittedLogs).not.toContain(resetLink);
      expect(emittedLogs).not.toContain('secret-bearer-token');
    },
  );
});
