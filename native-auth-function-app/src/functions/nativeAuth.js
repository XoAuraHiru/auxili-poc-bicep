import { app } from '@azure/functions';
import { safeStringify, withCorrelation, success, failure } from '../utils/shared.js';
import { validators } from '../validation/schemas.js';
import { normalizeSignUpContinuePayload, normalizePasswordResetContinuePayload } from '../normalizers/requestNormalizers.js';
import {
    ensureNativeConfig,
    signInWithPassword,
    signUpStart as performSignUpStart,
    signUpContinue as performSignUpContinue,
    passwordResetStart as performPasswordResetStart,
    passwordResetContinue as performPasswordResetContinue
} from '../services/nativeAuthService.js';
import { NativeAuthError } from '../errors/NativeAuthError.js';

const {
    signIn: validateSignIn,
    signUpStart: validateSignUpStart,
    signUpContinue: validateSignUpContinue,
    passwordResetStart: validatePasswordResetStart,
    passwordResetContinue: validatePasswordResetContinue
} = validators;

const parseJsonBody = async (request, context, correlationId, scope) => {
    try {
        return await request.json();
    } catch (error) {
        context.log.warn(`[NativeAuth][${scope}] Invalid JSON payload`, safeStringify({
            correlationId,
            message: error?.message
        }));
        return null;
    }
};

const cloneForValidation = (value) => JSON.parse(JSON.stringify(value));

app.http('NativeAuthHealth', {
    route: 'auth/health',
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        try {
            ensureNativeConfig();
            return success(200, {
                status: 'healthy',
                message: 'Native auth service is running',
                timestamp: new Date().toISOString()
            }, correlationId);
        } catch (error) {
            const details = error instanceof NativeAuthError ? { message: error.message } : undefined;
            return failure(500, 'Native auth service is misconfigured', correlationId, details);
        }
    }
});

app.http('NativeSignUpStart', {
    route: 'auth/signup/start',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'SignUpStart');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validateSignUpStart(body)) {
            context.log.warn('[NativeAuth][SignUpStart] Payload validation failed', safeStringify({
                correlationId,
                errors: validateSignUpStart.errors
            }));
            return failure(400, 'First name, last name, email, and password are required.', correlationId, validateSignUpStart.errors);
        }

        return performSignUpStart({
            email: String(body.email).trim(),
            password: String(body.password),
            firstName: String(body.firstName).trim(),
            lastName: String(body.lastName).trim(),
            additionalAttributes: body.attributes,
            correlationId,
            context
        });
    }
});

app.http('NativeSignUpContinue', {
    route: 'auth/signup/continue',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'SignUpContinue');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        const normalizedBody = normalizeSignUpContinuePayload(body);
        const payloadForValidation = cloneForValidation(normalizedBody);

        if (!validateSignUpContinue(payloadForValidation)) {
            return failure(400, 'Continuation token and grant type are required.', correlationId, validateSignUpContinue.errors);
        }

        const grantType = String(normalizedBody.grantType).toLowerCase();

        return performSignUpContinue({
            continuationToken: String(normalizedBody.continuationToken),
            grantType,
            code: grantType === 'oob' ? String(normalizedBody.code) : undefined,
            password: grantType === 'password' ? String(normalizedBody.password) : undefined,
            correlationId,
            context
        });
    }
});

app.http('NativePasswordSignIn', {
    route: 'auth/password',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'PasswordSignIn');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validateSignIn(body)) {
            context.log.warn('[NativeAuth] Payload validation failed', safeStringify({
                correlationId,
                errors: validateSignIn.errors
            }));
            return failure(400, 'Email and password are required', correlationId, validateSignIn.errors);
        }

        return signInWithPassword({
            email: String(body.email).trim(),
            password: String(body.password),
            correlationId,
            context
        });
    }
});

app.http('NativePasswordResetStart', {
    route: 'auth/password/reset/start',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'PasswordResetStart');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validatePasswordResetStart(body)) {
            return failure(400, 'Username is required.', correlationId, validatePasswordResetStart.errors);
        }

        return performPasswordResetStart({
            username: String(body.username).trim(),
            correlationId,
            context
        });
    }
});

app.http('NativePasswordResetContinue', {
    route: 'auth/password/reset/continue',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const body = await parseJsonBody(request, context, correlationId, 'PasswordResetContinue');
        if (!body) {
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        const normalizedBody = normalizePasswordResetContinuePayload(body);
        const payloadForValidation = cloneForValidation(normalizedBody);

        if (!validatePasswordResetContinue(payloadForValidation)) {
            return failure(400, 'Continuation token and grant type are required.', correlationId, validatePasswordResetContinue.errors);
        }

        const grantType = String(normalizedBody.grantType).toLowerCase();

        return performPasswordResetContinue({
            continuationToken: normalizedBody.continuationToken,
            grantType,
            code: normalizedBody.code,
            newPassword: normalizedBody.newPassword,
            correlationId,
            context
        });
    }
});
