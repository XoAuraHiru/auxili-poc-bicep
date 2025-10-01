import { apiRequest } from './apiClient.js';

/**
 * Calls the profile service without automatically attaching an access token.
 * Provide a token if you need an authenticated request, otherwise omit it to
 * validate that the endpoint rejects anonymous traffic.
 */
export function getMyProfile(token) {
    return apiRequest('/profile/me', {
        method: 'GET',
        token,
    });
}

export function getProfileSettings(token) {
    return apiRequest('/profile/settings', {
        method: 'GET',
        token,
    });
}
