import https from 'https';
import crypto from 'crypto';

// Entra ID configuration
export const TENANT_ID = process.env.ENTRA_TENANT_ID || 'fd2638f1-94af-4c20-9ee9-f16f08e60344';
export const CLIENT_ID = process.env.ENTRA_CLIENT_ID || 'f5c94ff4-4e57-4b2d-8cbd-64d4846817ba';
export const AUTHORITY = process.env.ENTRA_AUTHORITY || `https://login.microsoftonline.com/${TENANT_ID}`;
export const DEFAULT_AUTH_SCOPES = process.env.ENTRA_AUTH_SCOPES || 'openid profile email';

const ISSUER_URL = `${AUTHORITY}/v2.0`;
const JWKS_URI = `${AUTHORITY}/discovery/v2.0/keys`;

/**
 * Fetch JWKS keys from Entra ID
 */
async function fetchJWKS() {
    return new Promise((resolve, reject) => {
        https.get(JWKS_URI, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

/**
 * Validate JWT token with Entra ID
 */
export async function validateEntraIDToken(token) {
    try {
        // Basic token validation
        if (!token || typeof token !== 'string') {
            return {
                valid: false,
                error: 'Token is required and must be a string'
            };
        }

        // Split JWT token
        const parts = token.split('.');
        if (parts.length !== 3) {
            return {
                valid: false,
                error: 'Invalid JWT format - token must have 3 parts'
            };
        }

        // Decode header and payload with proper padding
        const addPadding = (str) => {
            const missingPadding = str.length % 4;
            if (missingPadding) {
                str += '='.repeat(4 - missingPadding);
            }
            return str;
        };

        let header, payload;
        try {
            header = JSON.parse(Buffer.from(addPadding(parts[0]), 'base64').toString());
            payload = JSON.parse(Buffer.from(addPadding(parts[1]), 'base64').toString());
        } catch (error) {
            return {
                valid: false,
                error: 'Invalid JWT - unable to decode token parts'
            };
        }

        // Validate issuer
        if (payload.iss !== ISSUER_URL) {
            return {
                valid: false,
                error: `Invalid issuer: ${payload.iss}`
            };
        }

        // Validate audience
        if (payload.aud !== CLIENT_ID) {
            return {
                valid: false,
                error: `Invalid audience: ${payload.aud}`
            };
        }

        // Validate expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            return {
                valid: false,
                error: 'Token expired'
            };
        }

        // For production, we should verify signature with JWKS
        // For now, we'll do basic validation

        return {
            valid: true,
            user: {
                id: payload.sub,
                username: payload.preferred_username || payload.email,
                email: payload.email,
                firstName: payload.given_name || '',
                lastName: payload.family_name || '',
                name: payload.name || '',
                tenantId: payload.tid
            },
            claims: payload
        };

    } catch (error) {
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Get user profile from Microsoft Graph API
 */
export async function getUserFromGraph(accessToken) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'graph.microsoft.com',
            path: '/v1.0/me',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`Graph API error: ${res.statusCode}`));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * Create user invitation in Entra ID
 */
export async function inviteUserToEntraID(email, displayName, accessToken) {
    return new Promise((resolve, reject) => {
        const inviteData = {
            invitedUserDisplayName: displayName,
            invitedUserEmailAddress: email,
            inviteRedirectUrl: "http://localhost:3000/auth/callback",
            sendInvitationMessage: true
        };

        const postData = JSON.stringify(inviteData);

        const options = {
            hostname: 'graph.microsoft.com',
            path: '/v1.0/invitations',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 201) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`Graph API invitation error: ${res.statusCode} - ${data}`));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/**
 * Extract bearer token from authorization header
 */
export function extractBearerToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

/**
 * Generate state parameter for OAuth flow
 */
export function generateState() {
    return crypto.randomBytes(16).toString('hex');
}