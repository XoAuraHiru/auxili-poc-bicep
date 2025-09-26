import { success, failure, safeStringify } from '../utils/shared.js';
import { getNativeAuthConfig } from '../config/nativeAuthConfig.js';
import { buildSignUpAttributesPayload } from './signUpAttributes.js';
import { callNativeAuthEndpoint } from '../clients/nativeAuthClient.js';
import { decodeJwtPayload } from '../utils/jwt.js';
import { buildUserFromClaims } from '../utils/user.js';
import { NativeAuthError } from '../errors/NativeAuthError.js';

export const ensureNativeConfig = () => getNativeAuthConfig();

const extractInvalidAttributes = (error) => {
    const invalidAttributes = error?.data?.invalid_attributes;
    if (!Array.isArray(invalidAttributes)) {
        return [];
    }
    return invalidAttributes.map((item) => item?.name || item?.attribute || item).filter(Boolean);
};

const extractRequiredAttributes = (error) => {
    const requiredAttributes = error?.data?.required_attributes;
    if (!Array.isArray(requiredAttributes)) {
        return [];
    }
    return requiredAttributes.map((item) => item?.name || item?.attribute || item).filter(Boolean);
};

export const normalizeNativeAuthError = (error, correlationId, context) => {
    if (!(error instanceof NativeAuthError)) {
        context.log.error('[NativeAuth] Unexpected error type', safeStringify({ correlationId, message: error?.message }));
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

    context.log.warn('[NativeAuth] API error', safeStringify({
        correlationId,
        status: error.status,
        code,
        subError,
        path: error.path,
        raw: error.rawResponse ? error.rawResponse.substring(0, 400) : null
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
        message = 'We couldn’t find an account with that email address.';
    } else if (code === 'invalid_request') {
        httpStatus = 400;
        message = 'The sign-in request was invalid. Please try again.';
    } else if (code === 'expired_token') {
        httpStatus = 401;
        message = 'The authentication session expired. Start the sign-in again.';
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
    if (!(error instanceof NativeAuthError)) {
        context.log.error('[NativeAuth][SignUp] Unexpected error type', safeStringify({ correlationId, message: error?.message }));
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

    context.log.warn('[NativeAuth][SignUp] API error', safeStringify({
        correlationId,
        status: error.status,
        code,
        subError,
        path: error.path,
        raw: error.rawResponse ? error.rawResponse.substring(0, 400) : null
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

export const signInWithPassword = async ({ email, password, correlationId, context }) => {
    const config = ensureNativeConfig();

    const initiateData = await callNativeAuthEndpoint(
        config,
        '/oauth2/v2.0/initiate',
        {
            client_id: config.clientId,
            username: email,
            challenge_type: config.challengeTypeString
        },
        correlationId,
        context
    );

    if (initiateData?.challenge_type === 'redirect') {
        return failure(400, 'Native authentication requires using the hosted Microsoft sign-in flow.', correlationId, {
            code: 'redirect_required'
        });
    }

    let continuationToken = initiateData?.continuation_token || null;
    let challengeType = initiateData?.challenge_type || null;

    if (!continuationToken) {
        throw new NativeAuthError('Native auth initiate response missing continuation token', {
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
                challenge_type: config.challengeTypeString
            },
            correlationId,
            context
        );

        if (challengeData?.challenge_type === 'redirect') {
            return failure(400, 'Native authentication requires using the hosted Microsoft sign-in flow.', correlationId, {
                code: 'redirect_required'
            });
        }

        continuationToken = challengeData?.continuation_token || continuationToken;
        challengeType = challengeData?.challenge_type || challengeType;

        if (challengeType && challengeType !== 'password') {
            context.log.warn('[NativeAuth] Unsupported challenge type received', safeStringify({ correlationId, challengeType }));
            return failure(400, `Unsupported authentication challenge type: ${challengeType}`, correlationId, {
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
            scope: config.scopes,
            username: email
        },
        correlationId,
        context
    );

    if (!tokenData?.id_token) {
        throw new NativeAuthError('Native auth token response missing id_token', {
            status: 500,
            data: tokenData,
            path: '/oauth2/v2.0/token'
        });
    }

    let claims;
    try {
        claims = decodeJwtPayload(tokenData.id_token);
    } catch (decodeError) {
        context.log.error('[NativeAuth] Failed to decode id_token', safeStringify({
            correlationId,
            message: decodeError?.message
        }));
        throw new NativeAuthError('Failed to decode id_token payload', {
            status: 500,
            data: tokenData,
            path: '/oauth2/v2.0/token'
        });
    }

    const user = buildUserFromClaims(claims, email);
    const expiresInSeconds = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : null;

    return success(200, {
        message: 'Authentication successful',
        user,
        accessToken: tokenData.access_token || null,
        idToken: tokenData.id_token,
        refreshToken: tokenData.refresh_token || null,
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || config.scopes,
        expiresIn: expiresInSeconds,
        expiresOn: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null,
        correlationId
    }, correlationId);
};

export const signUpStart = async ({ email, password, firstName, lastName, additionalAttributes, correlationId, context }) => {
    const config = ensureNativeConfig();

    const attributes = buildSignUpAttributesPayload({
        firstName,
        lastName,
        extraAttributes: additionalAttributes
    });

    const params = {
        client_id: config.clientId,
        username: email,
        password,
        challenge_type: config.signupChallengeTypeString
    };

    if (attributes) {
        params.attributes = attributes;
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
        throw new NativeAuthError('Native sign-up start response missing continuation token', {
            status: 500,
            data: startData,
            path: '/signup/v1.0/start'
        });
    }

    return success(200, {
        status: 'pending_verification',
        continuationToken,
        challengeType: startData?.challenge_type || null,
        challengeTargetLabel: startData?.challenge_target_label || null,
        message: 'Check your email for a verification code to continue registration.'
    }, correlationId);
};

export const signUpChallenge = async ({ continuationToken, correlationId, context }) => {
    const config = ensureNativeConfig();

    const challengeData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/challenge',
        {
            client_id: config.clientId,
            continuation_token: continuationToken,
            challenge_type: config.signupChallengeTypeString
        },
        correlationId,
        context
    );

    const updatedContinuationToken = challengeData?.continuation_token || continuationToken;

    return success(200, {
        status: 'code_sent',
        continuationToken: updatedContinuationToken,
        challengeType: challengeData?.challenge_type || null,
        challengeTargetLabel: challengeData?.challenge_target_label || null,
        message: 'Verification code sent. Enter the code to continue.'
    }, correlationId);
};

export const signUpContinue = async ({ continuationToken, grantType, code, password, correlationId, context }) => {
    const config = ensureNativeConfig();
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
        return success(200, {
            status: 'verify_password',
            continuationToken: continueData?.continuation_token || continuationToken,
            challengeType: continueData?.challenge_type || null,
            message: 'Code verified. Confirm your password to finish sign-up.'
        }, correlationId);
    }

    return success(201, {
        status: 'completed',
        message: 'Registration successful. You can now sign in with your password.',
        continuationToken: continueData?.continuation_token || null
    }, correlationId);
};

export const passwordResetStart = async ({ username, correlationId, context }) => {
    const config = ensureNativeConfig();

    const payload = {
        client_id: config.clientId,
        username,
        challenge_type: config.signupChallengeTypeString
    };

    const resetData = await callNativeAuthEndpoint(
        config,
        '/resetpassword/v1.0/start',
        payload,
        correlationId,
        context
    );

    const continuationToken = resetData?.continuation_token;

    if (!continuationToken) {
        throw new NativeAuthError('Password reset start response missing continuation token', {
            status: 500,
            data: resetData,
            path: '/resetpassword/v1.0/start'
        });
    }

    return success(200, {
        status: 'pending_verification',
        continuationToken,
        challengeType: resetData?.challenge_type || null,
        challengeTargetLabel: resetData?.challenge_target_label || null,
        message: 'Check your email for a verification code to reset your password.'
    }, correlationId);
};

export const passwordResetContinue = async ({ continuationToken, grantType, code, newPassword, correlationId, context }) => {
    const config = ensureNativeConfig();
    const payload = {
        client_id: config.clientId,
        continuation_token: continuationToken,
        grant_type: grantType
    };

    if (grantType === 'oob') {
        payload.oob = code;
    }

    if (grantType === 'password') {
        payload.new_password = newPassword;
    }

    const continueData = await callNativeAuthEndpoint(
        config,
        '/resetpassword/v1.0/continue',
        payload,
        correlationId,
        context
    );

    if (grantType === 'oob') {
        return success(200, {
            status: 'verify_password',
            continuationToken: continueData?.continuation_token || continuationToken,
            challengeType: continueData?.challenge_type || null,
            message: 'Code verified. Confirm your new password to finish resetting your password.'
        }, correlationId);
    }

    return success(200, {
        status: 'completed',
        message: 'Password reset successful. You can now sign in with your new password.',
        continuationToken: continueData?.continuation_token || null
    }, correlationId);
};
