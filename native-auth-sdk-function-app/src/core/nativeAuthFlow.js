import { callNativeAuthEndpoint } from '../clients/nativeAuthRestClient.js';
import { NativeAuthSdkError } from '../errors/NativeAuthSdkError.js';
import { safeStringify } from '../utils/shared.js';

const decodeJwtPayload = (jwt) => {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
        throw new NativeAuthSdkError('Invalid JWT structure returned from native auth endpoint', {
            code: 'invalid_jwt'
        });
    }

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);

    const decoded = Buffer.from(base64 + padding, 'base64').toString();
    return JSON.parse(decoded);
};

const buildUserFromClaims = (claims, fallbackEmail) => ({
    id: claims?.sub || null,
    username: claims?.preferred_username || claims?.email || fallbackEmail || null,
    email: claims?.email || fallbackEmail || claims?.preferred_username || null,
    firstName: claims?.given_name || '',
    lastName: claims?.family_name || '',
    name: claims?.name || claims?.preferred_username || fallbackEmail || '',
    tenantId: claims?.tid || claims?.tenantId || null
});

const extractInvalidAttributes = (error) => {
    const invalidAttributes = error?.data?.invalid_attributes;
    if (!Array.isArray(invalidAttributes)) {
        return [];
    }
    return invalidAttributes
        .map((item) => item?.name || item?.attribute || item)
        .filter(Boolean);
};

const extractRequiredAttributes = (error) => {
    const requiredAttributes = error?.data?.required_attributes;
    if (!Array.isArray(requiredAttributes)) {
        return [];
    }
    return requiredAttributes
        .map((item) => item?.name || item?.attribute || item)
        .filter(Boolean);
};

export const normalizeNativeAuthError = (error, correlationId, context) => {
    if (!(error instanceof NativeAuthSdkError)) {
        context?.log?.error?.('[NativeAuthSDK] Unexpected error type', safeStringify({
            correlationId,
            message: error?.message
        }));
        return {
            status: 500,
            message: 'Authentication failed due to an unexpected error.',
            info: {
                message: error?.message
            }
        };
    }

    const code = (error.code || '').toLowerCase();
    const subError = (error.subError || '').toLowerCase();
    const status = typeof error.status === 'number' && error.status > 0 ? error.status : undefined;

    context?.log?.warn?.('[NativeAuthSDK] API error', safeStringify({
        correlationId,
        status: error.status,
        code,
        subError,
        path: error.path
    }));

    let httpStatus = status || 500;
    let message = 'Authentication failed.';

    if (code === 'redirect') {
        httpStatus = 400;
        message = 'Native authentication requires switching to the hosted Microsoft sign-in experience.';
    } else if (code === 'invalid_grant' || httpStatus === 400) {
        httpStatus = 401;
        message = 'Invalid username or password, or additional verification is required.';
        if (subError === 'password_reset_required') {
            message = 'Password reset required before signing in.';
        } else if (subError === 'password_expired') {
            message = 'Password expired. Reset the password and try again.';
        } else if (subError === 'invalid_oob_value') {
            message = 'Invalid verification code. Request a new code and try again.';
        }
    } else if (code === 'user_not_found') {
        httpStatus = 404;
        message = 'Account not found.';
    } else if (code === 'invalid_request') {
        httpStatus = 400;
        message = 'The request was invalid. Please try again.';
    } else if (code === 'expired_token') {
        httpStatus = 401;
        message = 'The authentication session expired. Start the flow again.';
    } else if (code === 'unauthorized_client' || code === 'invalid_client' || subError === 'nativeauthapi_disabled') {
        httpStatus = 500;
        message = 'Native authentication is not enabled for this application.';
    }

    return {
        status: httpStatus,
        message,
        info: {
            code: error.code,
            subError: error.subError,
            status: error.status,
            path: error.path
        }
    };
};

export const normalizeNativeSignUpError = (error, correlationId, context) => {
    if (!(error instanceof NativeAuthSdkError)) {
        context?.log?.error?.('[NativeAuthSDK][SignUp] Unexpected error type', safeStringify({
            correlationId,
            message: error?.message
        }));
        return {
            status: 500,
            message: 'Registration failed due to an unexpected error.',
            info: {
                message: error?.message
            }
        };
    }

    const data = error.data || {};
    const code = (error.code || '').toLowerCase();
    const subError = (error.subError || '').toLowerCase();
    const status = typeof error.status === 'number' && error.status > 0 ? error.status : undefined;

    context?.log?.warn?.('[NativeAuthSDK][SignUp] API error', safeStringify({
        correlationId,
        status: error.status,
        code,
        subError,
        path: error.path
    }));

    const invalidAttributes = extractInvalidAttributes(error);
    const requiredAttributes = extractRequiredAttributes(error);

    let httpStatus = status || 500;
    let message = 'Registration failed.';

    if (code === 'user_already_exists') {
        httpStatus = 409;
        message = 'An account with that email already exists. Try signing in.';
    } else if (code === 'redirect') {
        httpStatus = 400;
        message = 'Complete registration in the hosted Microsoft sign-up experience.';
    } else if (code === 'invalid_request') {
        httpStatus = 400;
        message = 'The sign-up request was invalid. Please review the details and try again.';
    } else if (code === 'invalid_grant' || httpStatus === 400) {
        httpStatus = 400;
        if (subError === 'password_validation_failed') {
            message = 'The password does not meet complexity requirements.';
        } else if (subError === 'attribute_validation_failed') {
            message = 'Some of the provided details are invalid or incomplete.';
        } else if (subError === 'continuation_token_not_found') {
            message = 'The verification session expired. Restart sign-up.';
        } else if (subError === 'password_reset_required' || subError === 'password_expired') {
            httpStatus = 409;
            message = 'Complete the password reset before signing up.';
        } else {
            message = 'The provided information could not be validated.';
        }
    } else if (code === 'throttled') {
        httpStatus = 429;
        message = 'Too many sign-up attempts. Please wait a moment and try again.';
    }

    return {
        status: httpStatus,
        message,
        info: {
            code: error.code,
            subError: error.subError,
            status: error.status,
            path: error.path,
            requestParams: error.params,
            invalidAttributes,
            requiredAttributes,
            errorDescription: data?.error_description
        }
    };
};

export const passwordSignInFlow = async ({ config, email, password, correlationId, context }) => {
    const initiateData = await callNativeAuthEndpoint(
        config,
        '/oauth2/v2.0/initiate',
        {
            client_id: config.clientId,
            username: email,
            challenge_type: config.passwordChallengeString || config.passwordChallenges?.join(' ')
        },
        correlationId,
        context
    );

    if (initiateData?.challenge_type === 'redirect') {
        throw new NativeAuthSdkError('Redirect required for native auth sign-in', {
            status: 400,
            code: 'redirect'
        });
    }

    let continuationToken = initiateData?.continuation_token || null;
    let challengeType = initiateData?.challenge_type || null;

    if (!continuationToken) {
        throw new NativeAuthSdkError('Native auth initiate response missing continuation token', {
            status: 500,
            data: initiateData,
            path: '/oauth2/v2.0/initiate'
        });
    }

    if (!challengeType || challengeType !== 'password') {
        const challengeData = await callNativeAuthEndpoint(
            config,
            '/oauth2/v2.0/challenge',
            {
                client_id: config.clientId,
                continuation_token: continuationToken,
                challenge_type: config.passwordChallengeString || config.passwordChallenges?.join(' ')
            },
            correlationId,
            context
        );

        if (challengeData?.challenge_type === 'redirect') {
            throw new NativeAuthSdkError('Redirect required for native auth sign-in', {
                status: 400,
                code: 'redirect'
            });
        }

        continuationToken = challengeData?.continuation_token || continuationToken;
        challengeType = challengeData?.challenge_type || challengeType;

        if (challengeType && challengeType !== 'password') {
            throw new NativeAuthSdkError(`Unsupported authentication challenge type: ${challengeType}`, {
                status: 400,
                code: challengeType
            });
        }
    }

    const tokenData = await callNativeAuthEndpoint(
        config,
        '/oauth2/v2.0/token',
        {
            client_id: config.clientId,
            continuation_token: continuationToken,
            grant_type: 'password',
            password,
            scope: Array.isArray(config.scopes) ? config.scopes.join(' ') : config.scopes,
            username: email
        },
        correlationId,
        context
    );

    if (!tokenData?.id_token) {
        throw new NativeAuthSdkError('Native auth token response missing id_token', {
            status: 500,
            data: tokenData,
            path: '/oauth2/v2.0/token'
        });
    }

    const claims = decodeJwtPayload(tokenData.id_token);
    const user = buildUserFromClaims(claims, email);
    const expiresInSeconds = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : null;

    return {
        message: 'Authentication successful',
        user,
        accessToken: tokenData.access_token || null,
        idToken: tokenData.id_token,
        refreshToken: tokenData.refresh_token || null,
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || (Array.isArray(config.scopes) ? config.scopes.join(' ') : config.scopes),
        expiresIn: expiresInSeconds,
        expiresOn: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null,
        continuationToken
    };
};

export const signUpStartFlow = async ({ config, email, password, firstName, lastName, additionalAttributes, correlationId, context }) => {
    const params = {
        client_id: config.clientId,
        username: email,
        password,
        challenge_type: config.signupChallengeString || config.signupChallenges?.join(' '),
        channel_hint: 'email'
    };

    if (additionalAttributes && typeof additionalAttributes === 'object' && !Array.isArray(additionalAttributes)) {
        params.attributes = JSON.stringify({
            given_name: firstName,
            family_name: lastName,
            ...additionalAttributes
        });
    } else {
        params.attributes = JSON.stringify({
            given_name: firstName,
            family_name: lastName
        });
    }

    const startData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/start',
        params,
        correlationId,
        context
    );

    const continuationToken = startData?.continuation_token;

    if (!continuationToken) {
        throw new NativeAuthSdkError('Native sign-up start response missing continuation token', {
            status: 500,
            data: startData,
            path: '/signup/v1.0/start'
        });
    }

    const challengeData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/challenge',
        {
            client_id: config.clientId,
            continuation_token: continuationToken,
            challenge_type: config.signupChallengeString || config.signupChallenges?.join(' ')
        },
        correlationId,
        context
    );

    const challengeContinuationToken = challengeData?.continuation_token || continuationToken;

    return {
        status: 'code_sent',
        continuationToken: challengeContinuationToken,
        challengeType: challengeData?.challenge_type || startData?.challenge_type || null,
        challengeTargetLabel: challengeData?.challenge_target_label || startData?.challenge_target_label || null,
        challengeChannel: challengeData?.challenge_channel || null,
        challengeIntervalSeconds: typeof challengeData?.interval === 'number' ? challengeData.interval : null,
        challengeBindingMethod: challengeData?.binding_method || null,
        codeLength: typeof challengeData?.code_length === 'number' ? challengeData.code_length : null,
        message: 'Verification code sent. Enter the code we emailed you to continue registration.'
    };
};

export const signUpContinueFlow = async ({ config, continuationToken, grantType, code, password, correlationId, context }) => {
    const payload = {
        client_id: config.clientId,
        continuation_token: continuationToken,
        grant_type: grantType
    };

    if (grantType === 'oob') {
        payload.oob = code;
    }

    if (grantType === 'password') {
        payload.password = password;
    }

    const continueData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/continue',
        payload,
        correlationId,
        context
    );

    if (grantType === 'oob') {
        const nextContinuationToken = continueData?.continuation_token || continuationToken;
        const nextChallengeType = continueData?.challenge_type ? String(continueData.challenge_type).toLowerCase() : null;
        const requiredAttributes = Array.isArray(continueData?.required_attributes)
            ? continueData.required_attributes.map((item) => item?.name || item).filter(Boolean)
            : [];

        if (requiredAttributes.length) {
            return {
                status: 'attributes_required',
                continuationToken: nextContinuationToken,
                requiredAttributes,
                message: 'Additional information is required to finish registration.'
            };
        }

        if (nextChallengeType === 'password') {
            return {
                status: 'verify_password',
                continuationToken: nextContinuationToken,
                challengeType: 'password',
                message: 'Code verified. Confirm your password to finish sign-up.'
            };
        }

        return {
            status: 'completed',
            continuationToken: nextContinuationToken,
            challengeType: nextChallengeType,
            message: 'Registration completed. You can now sign in with your password.'
        };
    }

    return {
        status: 'completed',
        message: 'Registration successful. You can now sign in with your password.',
        continuationToken: continueData?.continuation_token || null
    };
};

export const passwordResetStartFlow = async ({ config, username, correlationId, context }) => {
    const resetData = await callNativeAuthEndpoint(
        config,
        '/resetpassword/v1.0/start',
        {
            client_id: config.clientId,
            username,
            challenge_type: config.signupChallengeString || config.signupChallenges?.join(' '),
            channel_hint: 'email'
        },
        correlationId,
        context
    );

    const continuationToken = resetData?.continuation_token;

    if (!continuationToken) {
        throw new NativeAuthSdkError('Password reset start response missing continuation token', {
            status: 500,
            data: resetData,
            path: '/resetpassword/v1.0/start'
        });
    }

    const challengeData = await callNativeAuthEndpoint(
        config,
        '/resetpassword/v1.0/challenge',
        {
            client_id: config.clientId,
            continuation_token: continuationToken,
            challenge_type: config.signupChallengeString || config.signupChallenges?.join(' ')
        },
        correlationId,
        context
    );

    const challengeContinuationToken = challengeData?.continuation_token || continuationToken;

    return {
        status: 'code_sent',
        continuationToken: challengeContinuationToken,
        challengeType: challengeData?.challenge_type || resetData?.challenge_type || null,
        challengeTargetLabel: challengeData?.challenge_target_label || resetData?.challenge_target_label || null,
        challengeChannel: challengeData?.challenge_channel || null,
        challengeIntervalSeconds: typeof challengeData?.interval === 'number' ? challengeData.interval : null,
        challengeBindingMethod: challengeData?.binding_method || null,
        codeLength: typeof challengeData?.code_length === 'number' ? challengeData.code_length : null,
        message: 'Verification code sent. Enter the code we emailed you to continue resetting your password.'
    };
};

export const passwordResetContinueFlow = async ({ config, continuationToken, grantType, code, newPassword, correlationId, context }) => {
    const basePayload = {
        client_id: config.clientId,
        continuation_token: continuationToken
    };

    let endpoint = null;
    let requestPayload = null;

    if (grantType === 'oob') {
        endpoint = '/resetpassword/v1.0/continue';
        requestPayload = {
            ...basePayload,
            grant_type: 'oob',
            oob: code
        };
    } else if (grantType === 'password') {
        endpoint = '/resetpassword/v1.0/submit';
        requestPayload = {
            ...basePayload,
            new_password: newPassword
        };
    } else {
        throw new NativeAuthSdkError(`Unsupported password reset grant type: ${grantType}`, {
            status: 400,
            code: 'unsupported_grant_type'
        });
    }

    const responseData = await callNativeAuthEndpoint(
        config,
        endpoint,
        requestPayload,
        correlationId,
        context
    );

    if (grantType === 'oob') {
        return {
            status: 'verify_password',
            continuationToken: responseData?.continuation_token || continuationToken,
            challengeType: responseData?.challenge_type || 'password',
            message: 'Code verified. Confirm your new password to finish resetting your password.'
        };
    }

    let resetStatus = null;
    const pollContinuationToken = responseData?.continuation_token || null;

    if (pollContinuationToken) {
        try {
            const pollData = await callNativeAuthEndpoint(
                config,
                '/resetpassword/v1.0/poll_completion',
                {
                    client_id: config.clientId,
                    continuation_token: pollContinuationToken
                },
                correlationId,
                context
            );
            resetStatus = pollData?.status || null;
        } catch (pollError) {
            context?.log?.warn?.('[NativeAuthSDK][PasswordReset] Poll completion failed', safeStringify({
                correlationId,
                message: pollError?.message
            }));
        }
    }

    return {
        status: 'completed',
        message: 'Password reset successful. You can now sign in with your new password.',
        continuationToken: pollContinuationToken,
        resetStatus: resetStatus || 'unknown'
    };
};
