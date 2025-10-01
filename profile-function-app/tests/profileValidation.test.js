import { describe, expect, it } from 'vitest';
import { sanitizeProfileUpdate } from '../src/services/profileValidation.js';
import { BadRequestError } from '../src/errors/httpErrors.js';

describe('sanitizeProfileUpdate', () => {
    it('accepts valid updates', () => {
        const result = sanitizeProfileUpdate({
            firstName: 'Jane',
            lastName: 'Doe',
            bio: 'Hello world',
            location: 'NYC',
            preferences: {
                theme: 'Dark',
                notifications: false,
                language: 'en-GB'
            }
        });

        expect(result).toMatchObject({
            firstName: 'Jane',
            lastName: 'Doe',
            bio: 'Hello world',
            location: 'NYC',
            preferences: {
                theme: 'dark',
                notifications: false,
                language: 'en-GB'
            }
        });
    });

    it('throws when payload has no valid fields', () => {
        expect(() => sanitizeProfileUpdate({ unknown: 'value' })).toThrow(BadRequestError);
    });

    it('throws when string fields exceed max length', () => {
        const longBio = 'x'.repeat(700);
        expect(() => sanitizeProfileUpdate({ bio: longBio })).toThrow(BadRequestError);
    });

    it('throws when preferences contain invalid types', () => {
        expect(() => sanitizeProfileUpdate({ preferences: { notifications: 'yes' } })).toThrow(BadRequestError);
    });
});
