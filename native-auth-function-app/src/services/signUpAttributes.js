import { getSignUpAttributeMap, getSignUpStaticAttributes, normalizeAttributeValue } from '../config/nativeAuthConfig.js';

const isReservedAttribute = (attribute) => {
    if (!attribute) {
        return false;
    }
    const normalized = attribute.toLowerCase();
    return normalized === 'username' || normalized === 'email';
};

export const buildSignUpAttributesPayload = ({ firstName, lastName, extraAttributes }) => {
    const safeFirstName = typeof firstName === 'string' ? firstName.trim() : '';
    const safeLastName = typeof lastName === 'string' ? lastName.trim() : '';
    const valueBag = {
        firstName: safeFirstName,
        lastName: safeLastName,
        displayName: `${safeFirstName} ${safeLastName}`.replace(/\s+/g, ' ').trim()
    };

    const payload = {};

    Object.entries(getSignUpAttributeMap()).forEach(([sourceKey, attributeName]) => {
        if (!attributeName || typeof attributeName !== 'string') {
            return;
        }
        const normalizedKey = attributeName.trim();
        if (!normalizedKey || isReservedAttribute(normalizedKey)) {
            return;
        }
        const value = normalizeAttributeValue(valueBag[sourceKey]);
        if (value) {
            payload[normalizedKey] = value;
        }
    });

    if (extraAttributes && typeof extraAttributes === 'object' && !Array.isArray(extraAttributes)) {
        Object.entries(extraAttributes).forEach(([attributeName, attributeValue]) => {
            const normalizedKey = typeof attributeName === 'string' ? attributeName.trim() : '';
            if (!normalizedKey || isReservedAttribute(normalizedKey)) {
                return;
            }
            const normalizedValue = normalizeAttributeValue(attributeValue);
            if (normalizedValue) {
                payload[normalizedKey] = normalizedValue;
            }
        });
    }

    Object.entries(getSignUpStaticAttributes()).forEach(([attributeName, attributeValue]) => {
        if (attributeName && attributeValue) {
            payload[attributeName] = attributeValue;
        }
    });

    if (!Object.keys(payload).length) {
        return null;
    }

    return JSON.stringify(payload);
};
