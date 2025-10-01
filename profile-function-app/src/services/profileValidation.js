import { BadRequestError } from '../errors/httpErrors.js';

export const allowedProfileFields = ['firstName', 'lastName', 'bio', 'location', 'preferences'];

const coerceString = (value, { field, maxLength = 120 }) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new BadRequestError(`${field} must be a string.`, { code: 'invalid_type', details: { field } });
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
        throw new BadRequestError(`${field} cannot be empty.`, { code: 'invalid_value', details: { field } });
    }

    if (trimmed.length > maxLength) {
        throw new BadRequestError(`${field} cannot exceed ${maxLength} characters.`, { code: 'max_length_exceeded', details: { field, maxLength } });
    }

    return trimmed;
};

const allowedPreferenceFields = {
    theme: (value) => coerceString(value, { field: 'preferences.theme', maxLength: 32 }).toLowerCase(),
    notifications: (value) => {
        if (value === undefined || value === null) {
            return undefined;
        }
        if (typeof value !== 'boolean') {
            throw new BadRequestError('preferences.notifications must be a boolean.', { code: 'invalid_type', details: { field: 'preferences.notifications' } });
        }
        return value;
    },
    language: (value) => coerceString(value, { field: 'preferences.language', maxLength: 12 }),
    timezone: (value) => coerceString(value, { field: 'preferences.timezone', maxLength: 64 })
};

const sanitizePreferences = (preferences) => {
    if (preferences === undefined) {
        return undefined;
    }

    if (preferences === null) {
        return null;
    }

    if (typeof preferences !== 'object' || Array.isArray(preferences)) {
        throw new BadRequestError('preferences must be an object.', { code: 'invalid_type', details: { field: 'preferences' } });
    }

    const sanitized = {};
    for (const [key, sanitizer] of Object.entries(allowedPreferenceFields)) {
        if (preferences[key] !== undefined) {
            const value = sanitizer(preferences[key]);
            if (value !== undefined) {
                sanitized[key] = value;
            }
        }
    }

    return Object.keys(sanitized).length ? sanitized : undefined;
};

export const sanitizeProfileUpdate = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new BadRequestError('Request body must be a JSON object.', { code: 'invalid_payload' });
    }

    const sanitized = {};

    if (payload.firstName !== undefined) {
        sanitized.firstName = coerceString(payload.firstName, { field: 'firstName', maxLength: 60 });
    }

    if (payload.lastName !== undefined) {
        sanitized.lastName = coerceString(payload.lastName, { field: 'lastName', maxLength: 60 });
    }

    if (payload.bio !== undefined) {
        sanitized.bio = coerceString(payload.bio, { field: 'bio', maxLength: 600 });
    }

    if (payload.location !== undefined) {
        sanitized.location = coerceString(payload.location, { field: 'location', maxLength: 120 });
    }

    const sanitizedPreferences = sanitizePreferences(payload.preferences);
    if (sanitizedPreferences !== undefined) {
        sanitized.preferences = sanitizedPreferences;
    }

    if (!Object.keys(sanitized).length) {
        throw new BadRequestError('No valid fields to update.', {
            code: 'no_valid_fields',
            details: {
                allowedFields: allowedProfileFields
            }
        });
    }

    return sanitized;
};
