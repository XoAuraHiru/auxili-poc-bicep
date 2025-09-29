import { app } from '@azure/functions';
import { safeStringify, withCorrelation, success, failure } from '../utils/shared.js';
import { validators } from '../validation/schemas.js';
import {
    signInWithPassword,
    signUpStart,
    signUpContinue,
    passwordResetStart,
    passwordResetContinue
} from '../services/nativeAuthSdkService.js';
import { getNativeAuthSdkConfig, DEFAULT_EMAIL_DOMAIN } from '../config/sdkConfig.js';
import { NativeAuthSdkError } from '../errors/NativeAuthSdkError.js';

const parseJsonBody = async (request, context, correlationId, scope) => {
    try {
        return await request.json();
    } catch (error) {
        context.log.warn(`[NativeAuthSDK][${scope}] Invalid JSON payload`, safeStringify({
            correlationId,
            message: error?.message
        }));
        return null;
    }
};

const ensureEmail = (email) => {
    if (email) {
        return email;
    }
    if (!DEFAULT_EMAIL_DOMAIN) {
        return null;
    }
    return `user@${DEFAULT_EMAIL_DOMAIN}`;
};

app.http('NativeAuthSdkHealth', {
    route: 'auth-sdk/health',
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        try {
            const config = getNativeAuthSdkConfig();
            return success(200, {
                status: 'healthy',
                message: 'Native auth SDK service is ready',
                timestamp: new Date().toISOString(),
                clientId: config.clientId,
                authority: config.authority,
                scopes: config.scopes
            }, correlationId);
        } catch (error) {
            const details = error instanceof NativeAuthSdkError ? { message: error.message, code: error.code } : undefined;
            return failure(500, 'Native auth SDK service is misconfigured', correlationId, details);
        }
    }
});

app.http('NativeAuthSdkSignIn', {
    route: 'auth-sdk/signin/password',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'SignIn');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validators.signIn(body)) {
            context.log.warn('[NativeAuthSDK][SignIn] Payload validation failed', safeStringify({
                correlationId,
                errors: validators.signIn.errors
            }));
            return failure(400, 'Email and password are required.', correlationId, validators.signIn.errors);
        }

        const email = ensureEmail(String(body.email).trim());

        return signInWithPassword({
            email,
            password: String(body.password),
            correlationId,
            context
        });
    }
});

app.http('NativeAuthSdkSignUpStart', {
    route: 'auth-sdk/signup/start',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'SignUpStart');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validators.signUpStart(body)) {
            context.log.warn('[NativeAuthSDK][SignUpStart] Payload validation failed', safeStringify({
                correlationId,
                errors: validators.signUpStart.errors
            }));
            return failure(400, 'First name, last name, email, and password are required.', correlationId, validators.signUpStart.errors);
        }

        return signUpStart({
            email: ensureEmail(String(body.email).trim()),
            password: String(body.password),
            firstName: String(body.firstName).trim(),
            lastName: String(body.lastName).trim(),
            additionalAttributes: body.attributes,
            correlationId,
            context
        });
    }
});

app.http('NativeAuthSdkSignUpContinue', {
    route: 'auth-sdk/signup/continue',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'SignUpContinue');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        const payload = {
            continuationToken: String(body.continuationToken || ''),
            grantType: String(body.grantType || '').toLowerCase(),
            code: body.code ? String(body.code) : undefined,
            password: body.password ? String(body.password) : undefined
        };

        const normalized = {
            continuationToken: payload.continuationToken,
            grantType: payload.grantType,
            code: payload.code,
            password: payload.password
        };

        if (!validators.signUpContinue(normalized)) {
            return failure(400, 'Continuation token and grant type are required.', correlationId, validators.signUpContinue.errors);
        }

        return signUpContinue({
            continuationToken: normalized.continuationToken,
            grantType: normalized.grantType,
            code: normalized.code,
            password: normalized.password,
            correlationId,
            context
        });
    }
});

app.http('NativeAuthSdkPasswordResetStart', {
    route: 'auth-sdk/password/reset/start',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'PasswordResetStart');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validators.passwordResetStart(body)) {
            return failure(400, 'Username is required.', correlationId, validators.passwordResetStart.errors);
        }

        return passwordResetStart({
            username: String(body.username).trim(),
            correlationId,
            context
        });
    }
});

app.http('NativeAuthSdkPasswordResetContinue', {
    route: 'auth-sdk/password/reset/continue',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'PasswordResetContinue');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        const normalized = {
            continuationToken: String(body.continuationToken || ''),
            grantType: String(body.grantType || '').toLowerCase(),
            code: body.code ? String(body.code) : undefined,
            newPassword: body.newPassword ? String(body.newPassword) : undefined
        };

        if (!validators.passwordResetContinue(normalized)) {
            return failure(400, 'Continuation token and grant type are required.', correlationId, validators.passwordResetContinue.errors);
        }

        return passwordResetContinue({
            continuationToken: normalized.continuationToken,
            grantType: normalized.grantType,
            code: normalized.code,
            newPassword: normalized.newPassword,
            correlationId,
            context
        });
    }
});
