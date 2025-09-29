import { NativeAuthSdkError } from '../errors/NativeAuthSdkError.js';
import { getNativeAuthSdkConfig } from '../config/sdkConfig.js';
import { safeStringify } from '../utils/shared.js';

let cachedClientPromise = null;

const CANDIDATE_FACTORY_KEYS = [
    'NativeAuthPublicClientApplication',
    'CustomAuthPublicClientApplication',
    'NativeAuthClient',
    'NativeAuthStandaloneClient'
];

const createSdkClient = async (config, context) => {
    const msal = await import('@azure/msal-node');

    const factories = CANDIDATE_FACTORY_KEYS
        .map((key) => msal[key])
        .filter((factory) => typeof factory === 'function');

    if (!factories.length) {
        throw new NativeAuthSdkError('Native auth SDK is not available in @azure/msal-node', {
            code: 'SDK_NOT_AVAILABLE',
            data: {
                availableExports: Object.keys(msal || {})
            }
        });
    }

    let nativeAuthClient = null;
    let metadata = null;

    for (const factory of factories) {
        try {
            const options = {
                auth: {
                    clientId: config.clientId,
                    authority: config.authority,
                    knownAuthorities: config.knownAuthorities?.length ? config.knownAuthorities : undefined
                },
                nativeAuth: {
                    challengeTypes: config.passwordChallenges,
                    signUpChallengeTypes: config.signupChallenges,
                    scopes: config.scopes
                },
                system: {
                    loggerOptions: {
                        loggerCallback: (level, message, containsPii) => {
                            if (containsPii) {
                                return;
                            }
                            if (level <= 2) {
                                context?.log?.warn?.(`[NativeAuthSDK][MSAL] ${message}`);
                            } else {
                                context?.log?.info?.(`[NativeAuthSDK][MSAL] ${message}`);
                            }
                        }
                    }
                }
            };

            let instance = null;

            if (typeof factory.create === 'function') {
                instance = await factory.create(options);
            } else {
                instance = new factory(options);
            }

            if (instance?.getNativeAuthClient) {
                nativeAuthClient = await instance.getNativeAuthClient();
            } else if (instance?.nativeAuthClient) {
                nativeAuthClient = instance.nativeAuthClient;
            } else if (instance?.signIn || instance?.signUp || instance?.passwordReset) {
                nativeAuthClient = instance;
            }

            if (nativeAuthClient) {
                metadata = {
                    factory: factory.name,
                    instanceType: instance?.constructor?.name,
                    providesGetNativeAuthClient: Boolean(instance?.getNativeAuthClient)
                };
                break;
            }
        } catch (error) {
            context?.log?.warn?.('[NativeAuthSDK] Failed to construct native auth client', safeStringify({
                factory: factory?.name || 'unknown',
                message: error?.message
            }));
        }
    }

    if (!nativeAuthClient) {
        throw new NativeAuthSdkError('Unable to instantiate native auth client from @azure/msal-node', {
            code: 'SDK_INIT_FAILED'
        });
    }

    return { nativeAuthClient, config, metadata };
};

export const getNativeAuthClient = async (context) => {
    if (!cachedClientPromise) {
        cachedClientPromise = (async () => {
            const config = getNativeAuthSdkConfig();
            try {
                return await createSdkClient(config, context);
            } catch (error) {
                cachedClientPromise = null;
                throw error;
            }
        })();
    }

    return cachedClientPromise;
};
