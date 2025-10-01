import { sanitizeProfileUpdate } from './profileValidation.js';

const profileStore = new Map([
    ['user-123', {
        id: 'user-123',
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe',
        bio: 'Software engineer passionate about cloud architecture.',
        location: 'San Francisco, CA',
        joinedDate: '2024-01-15T00:00:00Z',
        preferences: {
            theme: 'dark',
            notifications: true,
            language: 'en-US',
            timezone: 'America/Los_Angeles'
        },
        updatedAt: '2024-03-01T12:00:00Z'
    }]
]);

const clone = (value) => JSON.parse(JSON.stringify(value));

const buildDefaultProfile = (user) => ({
    id: user.id,
    email: user.email ?? null,
    firstName: 'Unknown',
    lastName: 'User',
    bio: null,
    location: null,
    joinedDate: new Date().toISOString(),
    preferences: {
        theme: 'light',
        notifications: true,
        language: 'en-US',
        timezone: 'UTC'
    }
});

export const getProfile = (user) => {
    if (!user?.id) {
        throw new Error('A user identifier is required to fetch a profile.');
    }

    const existing = profileStore.get(user.id);
    if (existing) {
        return clone(existing);
    }

    const profile = buildDefaultProfile(user);
    profileStore.set(user.id, profile);
    return clone(profile);
};

export const updateProfile = (user, payload) => {
    if (!user?.id) {
        throw new Error('A user identifier is required to update a profile.');
    }

    const sanitized = sanitizeProfileUpdate(payload);
    const current = profileStore.get(user.id) ?? buildDefaultProfile(user);

    const mergedPreferences = sanitized.preferences
        ? { ...current.preferences, ...sanitized.preferences }
        : current.preferences;

    const updatedProfile = {
        ...current,
        ...sanitized,
        preferences: mergedPreferences,
        id: user.id,
        email: current.email ?? user.email ?? null,
        updatedAt: new Date().toISOString()
    };

    profileStore.set(user.id, updatedProfile);
    return clone(updatedProfile);
};

export const deleteProfile = (user) => {
    if (!user?.id) {
        return false;
    }
    return profileStore.delete(user.id);
};

export const getPreferences = (user) => {
    const profile = getProfile(user);
    return clone(profile.preferences ?? {});
};

export const __resetProfiles = () => {
    profileStore.clear();
    profileStore.set('user-123', {
        id: 'user-123',
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe',
        bio: 'Software engineer passionate about cloud architecture.',
        location: 'San Francisco, CA',
        joinedDate: '2024-01-15T00:00:00Z',
        preferences: {
            theme: 'dark',
            notifications: true,
            language: 'en-US',
            timezone: 'America/Los_Angeles'
        },
        updatedAt: '2024-03-01T12:00:00Z'
    });
};
