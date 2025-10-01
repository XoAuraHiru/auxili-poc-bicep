import { beforeEach, describe, expect, it } from 'vitest';
import { __resetProfiles, deleteProfile, getPreferences, getProfile, updateProfile } from '../src/services/profileStore.js';

describe('profileStore', () => {
    const user = { id: 'user-999', email: 'tester@example.com' };

    beforeEach(() => {
        __resetProfiles();
    });

    it('returns default profile for new users', () => {
        const profile = getProfile(user);
        expect(profile.id).toBe(user.id);
        expect(profile.email).toBe(user.email);
        expect(profile.preferences).toMatchObject({ theme: 'light', notifications: true });
    });

    it('persists updates back into the store', () => {
        const updated = updateProfile(user, {
            firstName: 'Test',
            preferences: {
                theme: 'light',
                notifications: false
            }
        });

        expect(updated.firstName).toBe('Test');
        expect(updated.preferences.notifications).toBe(false);

        const fetched = getProfile(user);
        expect(fetched.firstName).toBe('Test');
    });

    it('merges preference updates', () => {
        updateProfile(user, { preferences: { theme: 'dark' } });
        const preferences = getPreferences(user);
        expect(preferences.theme).toBe('dark');
        expect(preferences.notifications).toBe(true);
    });

    it('removes profile data', () => {
        updateProfile(user, { firstName: 'Delete Me' });
        const removed = deleteProfile(user);
        expect(removed).toBe(true);
        const afterDeletion = getProfile(user);
        expect(afterDeletion.firstName).toBe('Unknown');
    });
});
