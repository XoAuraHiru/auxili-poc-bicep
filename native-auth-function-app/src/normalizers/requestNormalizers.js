const normalizePayload = (body, mappings) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return body;
    }

    const normalized = { ...body };

    const findValue = (...keys) => {
        for (const key of keys) {
            if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
                return body[key];
            }
            const lowerKey = typeof key === 'string' ? key.toLowerCase() : key;
            if (body[lowerKey] !== undefined && body[lowerKey] !== null && body[lowerKey] !== '') {
                return body[lowerKey];
            }
        }
        return undefined;
    };

    mappings.forEach(({ property, aliases = [], transform }) => {
        const value = findValue(property, ...aliases);
        if (value !== undefined) {
            normalized[property] = transform ? transform(value) : value;
        }
    });

    return normalized;
};

export const normalizeSignUpContinuePayload = (body) => normalizePayload(body, [
    {
        property: 'continuationToken',
        aliases: ['continuation_token', 'continuationtoken', 'continuation'],
        transform: (value) => String(value).trim()
    },
    {
        property: 'grantType',
        aliases: ['grant_type', 'grant', 'type'],
        transform: (value) => String(value).trim().toLowerCase()
    },
    {
        property: 'code',
        aliases: ['verificationCode', 'verification_code', 'otp', 'oob', 'oneTimeCode', 'one_time_code'],
        transform: (value) => String(value).trim()
    },
    {
        property: 'password',
        aliases: ['newPassword', 'new_password'],
        transform: (value) => String(value)
    }
]);

export const normalizePasswordResetContinuePayload = (body) => normalizePayload(body, [
    {
        property: 'continuationToken',
        aliases: ['continuation_token', 'continuationtoken', 'continuation'],
        transform: (value) => String(value).trim()
    },
    {
        property: 'grantType',
        aliases: ['grant_type', 'grant', 'type'],
        transform: (value) => String(value).trim().toLowerCase()
    },
    {
        property: 'code',
        aliases: ['verificationCode', 'verification_code', 'otp', 'oob', 'oneTimeCode', 'one_time_code'],
        transform: (value) => String(value).trim()
    },
    {
        property: 'newPassword',
        aliases: ['new_password', 'password'],
        transform: (value) => String(value)
    }
]);
