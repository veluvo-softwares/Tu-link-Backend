export class RetryUtils {
  /**
   * Calculate exponential backoff delay
   * @param attempt Current attempt number (starts at 1)
   * @param baseDelay Base delay in milliseconds
   * @param maxDelay Maximum delay in milliseconds
   */
  static calculateBackoff(
    attempt: number,
    baseDelay: number = 1000,
    maxDelay: number = 30000,
  ): number {
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    return delay;
  }

  /**
   * Retry a function with exponential backoff
   * @param fn Function to retry
   * @param maxAttempts Maximum number of attempts
   * @param baseDelay Base delay in milliseconds
   */
  static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxAttempts) {
          const delay = this.calculateBackoff(attempt, baseDelay);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }
}
