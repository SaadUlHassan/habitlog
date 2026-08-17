/**
 * The authenticated caller. Deliberately does not carry the user's email: no
 * endpoint needs it, and personal data you do not hold cannot leak.
 */
export type AuthUser = {
  id: number;
  displayName: string;
  timezone: string;
};

declare global {
  namespace Express {
    interface Request {
      /** Set by requestContext, which is mounted first so everything downstream can rely on it. */
      requestId: string;
      /**
       * Set only by the authenticate middleware. Optional because unauthenticated
       * routes exist (/health), so reading it has to be a decision rather than an
       * assumption — see requireUser.
       */
      user?: AuthUser;
    }
  }
}
