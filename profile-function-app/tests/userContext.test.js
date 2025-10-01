import { describe, expect, it } from 'vitest';
import { ensureAuthenticated, ensureHasScope, getUserContext } from '../src/core/userContext.js';
import { ForbiddenError, UnauthorizedError } from '../src/errors/httpErrors.js';

const buildRequest = (headers = {}) => ({
    headers: new Headers(headers)
});

describe('userContext', () => {
    it('extracts user properties from headers', () => {
        const request = buildRequest({
            'x-user-object-id': 'abc-123',
            'x-user-principal-name': 'user@example.com',
            'x-user-scopes': 'profile.read profile.write',
            'x-environment': 'dev'
        });

        const context = getUserContext(request);
        expect(context.id).toBe('abc-123');
        expect(context.email).toBe('user@example.com');
        expect(context.environment).toBe('dev');
        expect(context.scopes).toEqual(['profile.read', 'profile.write']);
        expect(context.scopeSet.has('profile.write')).toBe(true);
    });

    it('throws when user is not authenticated', () => {
        const request = buildRequest();
        const context = getUserContext(request);
        expect(() => ensureAuthenticated(context)).toThrow(UnauthorizedError);
    });

    it('validates required scopes', () => {
        const request = buildRequest({ 'x-user-object-id': '123', 'x-user-scopes': 'profile.read' });
        const user = getUserContext(request);
        ensureAuthenticated(user);
        expect(() => ensureHasScope(user, ['profile.write'])).toThrow(ForbiddenError);
        expect(() => ensureHasScope(user, ['profile.read'])).not.toThrow();
    });
});
