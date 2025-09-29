import { NativeAuthSdkError } from '../errors/NativeAuthSdkError.js';
import { getNativeAuthClient } from '../clients/nativeAuthClient.js';
import { getNativeAuthSdkConfig } from '../config/sdkConfig.js';
import { safeStringify } from '../utils/shared.js';
import {
    signInWithPasswordRest,
    signUpStartRest,
    signUpContinueRest,
    passwordResetStartRest,
    passwordResetContinueRest
} from './restNativeAuthService.js';

const OPERATION_METHODS = {
    signIn: ['signIn', 'passwordSignIn', 'signInWithPassword'],
    signUpStart: ['signUpStart', 'startSignUp', 'signUp'],
    signUpContinue: ['signUpContinue', 'continueSignUp', 'completeSignUp', 'continue'],
    passwordResetStart: ['passwordResetStart', 'startPasswordReset', 'resetPasswordStart', 'resetPassword'],
    passwordResetContinue: ['passwordResetContinue', 'continuePasswordReset', 'completePasswordReset', 'resetPasswordContinue', 'continue']
};

const captureSdkArtifact = (value) => {
    try {
        return JSON.parse(safeStringify(value));
    } catch (error) {
        return {
            note: 'Failed to serialize SDK artifact',
            message: error?.message
        };
    }
};

const resolveConfig = (sdkContext, fallbackConfig, correlationId, context) => {
    if (sdkContext?.config) {
        return sdkContext.config;
    }

    if (fallbackConfig) {
        return fallbackConfig;
    }

    try {
        return getNativeAuthSdkConfig();
    } catch (error) {
        context?.log?.error?.('[NativeAuthSDK] Config resolution failed', safeStringify({
            correlationId,
            message: error?.message
        }));
        throw error;
    }
};

const attemptSdkOperation = async (operation, args, context) => {
    let sdkContext = null;
    try {
        const { nativeAuthClient, config, metadata } = await getNativeAuthClient(context);
        const candidates = OPERATION_METHODS[operation] || [];
        const methodName = candidates.find((name) => typeof nativeAuthClient?.[name] === 'function');

        if (!methodName) {
            throw new NativeAuthSdkError(`No matching method found on native auth client for operation ${operation}`, {
                code: 'SDK_METHOD_NOT_FOUND',
                data: { candidates }
            });
        }

        const sdkResult = await nativeAuthClient[methodName](args);
        sdkContext = {
            sdkResult,
            methodName,
            metadata,
            config
        };

        context?.log?.info?.('[NativeAuthSDK] Operation succeeded using SDK', safeStringify({
            operation,
            methodName,
            metadata
        }));
    } catch (error) {
        if (error instanceof NativeAuthSdkError) {
            context?.log?.warn?.('[NativeAuthSDK] Falling back to REST implementation', safeStringify({
                operation,
                message: error?.message,
                code: error?.code
            }));
        } else {
            context?.log?.error?.('[NativeAuthSDK] Unexpected SDK error', safeStringify({
                operation,
                message: error?.message
            }));
        }
        return null;
    }

    return sdkContext;
};

const augmentWithSdk = (response, sdkContext) => {
    if (!response || !sdkContext) {
        return response;
    }

    const augmented = { ...response };
    augmented.jsonBody = {
        ...response.jsonBody,
        sdk: {
            mode: 'msal-node-native-auth',
            method: sdkContext.methodName,
            metadata: sdkContext.metadata,
            rawResult: captureSdkArtifact(sdkContext.sdkResult)
        }
    };

    return augmented;
};

export const signInWithPassword = async ({ email, password, correlationId, context }) => {
    const baseConfig = (() => {
        try {
            return getNativeAuthSdkConfig();
        } catch (error) {
            throw error;
        }
    })();

    const sdkAttempt = await attemptSdkOperation('signIn', {
        username: email,
        password,
        scopes: baseConfig.scopes
    }, context);

    const config = resolveConfig(sdkAttempt, baseConfig, correlationId, context);
    const response = await signInWithPasswordRest({
        config,
        email,
        password,
        correlationId,
        context
    });

    return augmentWithSdk(response, sdkAttempt);
};

export const signUpStart = async ({ email, password, firstName, lastName, additionalAttributes, correlationId, context }) => {
    const attributes = {
        email,
        password,
        firstName,
        lastName,
        attributes: additionalAttributes
    };

    const sdkAttempt = await attemptSdkOperation('signUpStart', attributes, context);
    const config = resolveConfig(sdkAttempt, null, correlationId, context);

    const response = await signUpStartRest({
        config,
        email,
        password,
        firstName,
        lastName,
        additionalAttributes,
        correlationId,
        context
    });

    return augmentWithSdk(response, sdkAttempt);
};

export const signUpContinue = async ({ continuationToken, grantType, code, password, correlationId, context }) => {
    const sdkAttempt = await attemptSdkOperation('signUpContinue', {
        continuationToken,
        grantType,
        code,
        password
    }, context);

    const config = resolveConfig(sdkAttempt, null, correlationId, context);

    const response = await signUpContinueRest({
        config,
        continuationToken,
        grantType,
        code,
        password,
        correlationId,
        context
    });

    return augmentWithSdk(response, sdkAttempt);
};

export const passwordResetStart = async ({ username, correlationId, context }) => {
    const sdkAttempt = await attemptSdkOperation('passwordResetStart', { username }, context);
    const config = resolveConfig(sdkAttempt, null, correlationId, context);

    const response = await passwordResetStartRest({
        config,
        username,
        correlationId,
        context
    });

    return augmentWithSdk(response, sdkAttempt);
};

export const passwordResetContinue = async ({ continuationToken, grantType, code, newPassword, correlationId, context }) => {
    const sdkAttempt = await attemptSdkOperation('passwordResetContinue', {
        continuationToken,
        grantType,
        code,
        newPassword
    }, context);

    const config = resolveConfig(sdkAttempt, null, correlationId, context);

    const response = await passwordResetContinueRest({
        config,
        continuationToken,
        grantType,
        code,
        newPassword,
        correlationId,
        context
    });

    return augmentWithSdk(response, sdkAttempt);
};
