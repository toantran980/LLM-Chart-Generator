import type { RequestHandler } from 'express';
import { ApiError } from '../errors';

export interface AuthContext {
  type: 'bearer' | 'client_deterrent' | 'open';
  identity: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireApiSecret(): RequestHandler {
  const publicSecret = process.env.APP_API_KEY?.trim();
  const serverSecret = process.env.SERVER_API_KEY?.trim();
  const requirePrivateAuth = process.env.REQUIRE_PRIVATE_AUTH === 'true';

  if (!publicSecret && !serverSecret && !requirePrivateAuth) {
    return (req, _res, next) => {
      req.auth = { type: 'open', identity: 'anonymous' };
      next();
    };
  }

  return (req, _res, next) => {
    const authHeader = req.header('authorization');
    const xApiKey = req.header('x-api-key');

    // 1. Check Bearer Token (Real server-side identity / authorization)
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      if (serverSecret && token === serverSecret) {
        req.auth = { type: 'bearer', identity: 'server' };
        return next();
      }
      if (serverSecret) {
        return next(new ApiError('Invalid authorization token', 401, 'UNAUTHORIZED'));
      }
    }

    // 2. If private authorization is strictly enforced, reject requests without valid Bearer
    if (requirePrivateAuth) {
      return next(
        new ApiError(
          'Private API authorization required. Please provide a valid Bearer token.',
          401,
          'UNAUTHORIZED',
        ),
      );
    }

    // 3. Check public frontend deterrent key (APP_API_KEY)
    if (publicSecret) {
      if (xApiKey === publicSecret) {
        req.auth = { type: 'client_deterrent', identity: 'client' };
        return next();
      }
      return next(new ApiError('Unauthorized', 401, 'UNAUTHORIZED'));
    }

    // 4. If serverSecret is configured without APP_API_KEY, require Bearer token
    if (serverSecret) {
      return next(new ApiError('Unauthorized', 401, 'UNAUTHORIZED'));
    }

    req.auth = { type: 'open', identity: 'anonymous' };
    next();
  };
}
