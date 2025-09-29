import { success, failure } from '../utils/shared.js';
import {
    passwordSignInFlow,
    signUpStartFlow,
    signUpContinueFlow,
    passwordResetStartFlow,
    passwordResetContinueFlow,
    normalizeNativeAuthError,
    normalizeNativeSignUpError
} from '../core/nativeAuthFlow.js';

const formatError = (error, correlationId, context, normalizer = normalizeNativeAuthError) => {
    const normalized = normalizer(error, correlationId, context) || {};
    const status = typeof normalized.status === 'number' ? normalized.status : 500;
    const message = normalized.message || 'Native authentication failed.';
    return failure(status, message, correlationId, normalized.info);
};

export const signInWithPasswordRest = async ({ config, email, password, correlationId, context }) => {
    try {
        const result = await passwordSignInFlow({
            config,
            email,
            password,
            correlationId,
            context
        });

        return success(200, result, correlationId);
    } catch (error) {
        return formatError(error, correlationId, context, normalizeNativeAuthError);
    }
};

export const signUpStartRest = async ({ config, email, password, firstName, lastName, additionalAttributes, correlationId, context }) => {
    try {
        const result = await signUpStartFlow({
            config,
            email,
            password,
            firstName,
            lastName,
            additionalAttributes,
            correlationId,
            context
        });

        return success(200, result, correlationId);
    } catch (error) {
        return formatError(error, correlationId, context, normalizeNativeSignUpError);
    }
};

export const signUpContinueRest = async ({ config, continuationToken, grantType, code, password, correlationId, context }) => {
    try {
        const result = await signUpContinueFlow({
            config,
            continuationToken,
            grantType,
            code,
            password,
            correlationId,
            context
        });

        const statusCode = result?.status === 'completed' ? 201 : 200;
        return success(statusCode, result, correlationId);
    } catch (error) {
        return formatError(error, correlationId, context, normalizeNativeSignUpError);
    }
};

export const passwordResetStartRest = async ({ config, username, correlationId, context }) => {
    try {
        const result = await passwordResetStartFlow({
            config,
            username,
            correlationId,
            context
        });

        return success(200, result, correlationId);
    } catch (error) {
        return formatError(error, correlationId, context, normalizeNativeAuthError);
    }
};

export const passwordResetContinueRest = async ({ config, continuationToken, grantType, code, newPassword, correlationId, context }) => {
    try {
        const result = await passwordResetContinueFlow({
            config,
            continuationToken,
            grantType,
            code,
            newPassword,
            correlationId,
            context
        });

        return success(200, result, correlationId);
    } catch (error) {
        return formatError(error, correlationId, context, normalizeNativeAuthError);
    }
};
