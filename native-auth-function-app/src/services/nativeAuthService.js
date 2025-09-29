import { success, failure } from '../utils/shared.js';
import { getNativeAuthConfig } from '../config/nativeAuthConfig.js';
import { buildSignUpAttributesPayload } from './signUpAttributes.js';
import {
    passwordSignInFlow,
    signUpStartFlow,
    signUpContinueFlow,
    passwordResetStartFlow,
    passwordResetContinueFlow,
    normalizeNativeAuthError,
    normalizeNativeSignUpError
} from '../core/nativeAuthFlow.js';

export const ensureNativeConfig = () => getNativeAuthConfig();

const handleError = (error, correlationId, context, normalizer) => {
    const normalized = normalizer(error, correlationId, context);
    return failure(normalized.status, normalized.message, correlationId, normalized.info);
};

export const signInWithPassword = async ({ email, password, correlationId, context }) => {
    const config = ensureNativeConfig();

    try {
        const result = await passwordSignInFlow({
            config,
            email,
            password,
            correlationId,
            context
        });

        return success(200, {
            ...result,
            correlationId
        }, correlationId);
    } catch (error) {
        return handleError(error, correlationId, context, normalizeNativeAuthError);
    }
};

export const signUpStart = async ({ email, password, firstName, lastName, additionalAttributes, correlationId, context }) => {
    const config = ensureNativeConfig();
    const attributesPayload = buildSignUpAttributesPayload({
        firstName,
        lastName,
        extraAttributes: additionalAttributes
    });

    try {
        const result = await signUpStartFlow({
            config,
            email,
            password,
            attributesPayload,
            correlationId,
            context
        });

        return success(200, result, correlationId);
    } catch (error) {
        return handleError(error, correlationId, context, normalizeNativeSignUpError);
    }
};

export const signUpContinue = async ({ continuationToken, grantType, code, password, correlationId, context }) => {
    const config = ensureNativeConfig();

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
        return handleError(error, correlationId, context, normalizeNativeSignUpError);
    }
};

export const passwordResetStart = async ({ username, correlationId, context }) => {
    const config = ensureNativeConfig();

    try {
        const result = await passwordResetStartFlow({
            config,
            username,
            correlationId,
            context
        });

        return success(200, result, correlationId);
    } catch (error) {
        return handleError(error, correlationId, context, normalizeNativeAuthError);
    }
};

export const passwordResetContinue = async ({ continuationToken, grantType, code, newPassword, correlationId, context }) => {
    const config = ensureNativeConfig();

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
        return handleError(error, correlationId, context, normalizeNativeAuthError);
    }
};
