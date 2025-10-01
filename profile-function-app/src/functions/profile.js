// profile-function-app/src/functions/profile.js
import { app } from '@azure/functions';
import { getUserContext, ensureAuthenticated, ensureHasScope } from '../core/userContext.js';
import { BadRequestError, InternalServerError, isHttpError } from '../errors/httpErrors.js';
import { deleteProfile, getPreferences, getProfile, updateProfile } from '../services/profileStore.js';
import { resolveCorrelationId } from '../utils/correlation.js';
import { errorResponse, noContentResponse, successResponse } from '../utils/httpResponse.js';

const WRITE_SCOPES = ['profile.write', 'user.write'];
const DELETE_SCOPES = ['profile.delete', 'user.delete'];

const buildMeta = (user, correlationId, overrides = {}) => ({
    correlationId,
    userId: user.id,
    environment: user.environment,
    scopes: user.scopes,
    ...overrides
});

const parseJson = async (request) => {
    try {
        return await request.json();
    } catch (error) {
        throw new BadRequestError('Invalid JSON payload received.', {
            code: 'invalid_json'
        });
    }
};

const withRequestContext = (request, context) => {
    const correlationId = resolveCorrelationId(request);
    const user = getUserContext(request);

    context.log('[Profile] Request received', {
        correlationId,
        userId: user.id,
        method: request.method,
        url: request.url
    });

    return { correlationId, user };
};

const normalizeError = (error) => {
    if (isHttpError(error)) {
        return error;
    }
    const internal = new InternalServerError();
    if (error instanceof Error && error.message) {
        internal.details = {
            ...(internal.details ?? {}),
            reason: error.message
        };
    }
    return internal;
};

const handleError = (error, correlationId, context) => {
    const normalizedError = normalizeError(error);
    const severity = normalizedError.status >= 500 ? 'error' : 'warn';
    context.log[severity]('[Profile] Request failed', {
        correlationId,
        error: normalizedError.message,
        code: normalizedError.code ?? 'internal_error',
        details: normalizedError.details ?? null
    });
    return errorResponse({ error: normalizedError, correlationId });
};

app.http('GetMyProfile', {
    route: 'profile/me',
    methods: ['GET'],
    authLevel: 'function',
    handler: async (request, context) => {
        const { correlationId, user } = withRequestContext(request, context);

        try {
            ensureAuthenticated(user);
            const profile = getProfile(user);
            return successResponse({
                status: 200,
                data: profile,
                correlationId,
                meta: buildMeta(user, correlationId, { authenticatedAs: user.email })
            });
        } catch (error) {
            return handleError(error, correlationId, context);
        }
    }
});

app.http('UpdateMyProfile', {
    route: 'profile/me',
    methods: ['PUT'],
    authLevel: 'function',
    handler: async (request, context) => {
        const { correlationId, user } = withRequestContext(request, context);

        try {
            ensureAuthenticated(user);
            ensureHasScope(user, WRITE_SCOPES);

            const updates = await parseJson(request);
            const updatedProfile = updateProfile(user, updates);

            context.log('[Profile] Updated profile', {
                correlationId,
                userId: user.id
            });

            return successResponse({
                status: 200,
                data: updatedProfile,
                correlationId,
                meta: buildMeta(user, correlationId, { message: 'Profile updated successfully.' })
            });
        } catch (error) {
            return handleError(error, correlationId, context);
        }
    }
});

app.http('GetUserSettings', {
    route: 'profile/settings',
    methods: ['GET'],
    authLevel: 'function',
    handler: async (request, context) => {
        const { correlationId, user } = withRequestContext(request, context);

        try {
            ensureAuthenticated(user);
            const preferences = getPreferences(user);
            return successResponse({
                status: 200,
                data: preferences,
                correlationId,
                meta: buildMeta(user, correlationId, { lastModified: new Date().toISOString() })
            });
        } catch (error) {
            return handleError(error, correlationId, context);
        }
    }
});

app.http('DeleteMyProfile', {
    route: 'profile/me',
    methods: ['DELETE'],
    authLevel: 'function',
    handler: async (request, context) => {
        const { correlationId, user } = withRequestContext(request, context);

        try {
            ensureAuthenticated(user);
            ensureHasScope(user, DELETE_SCOPES);

            const removed = deleteProfile(user);
            context.log('[Profile] Delete requested', {
                correlationId,
                userId: user.id,
                removed
            });

            return noContentResponse({ correlationId });
        } catch (error) {
            return handleError(error, correlationId, context);
        }
    }
});

app.http('ProfileHealth', {
    route: 'profile/health',
    methods: ['GET'],
    authLevel: 'function',
    handler: async () => successResponse({
        status: 200,
        correlationId: 'healthcheck',
        data: {
            status: 'healthy',
            service: 'profile-function-app',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        },
        meta: {
            correlationId: 'healthcheck'
        }
    })
});