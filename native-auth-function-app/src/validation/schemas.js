import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, removeAdditional: false });
addFormats(ajv);

const signInSchema = {
    type: 'object',
    properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 }
    },
    required: ['email', 'password'],
    additionalProperties: false
};

const signUpStartSchema = {
    type: 'object',
    properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        firstName: { type: 'string', minLength: 1 },
        lastName: { type: 'string', minLength: 1 },
        attributes: {
            type: 'object',
            minProperties: 1,
            propertyNames: {
                type: 'string',
                minLength: 1
            },
            patternProperties: {
                '^.+$': {
                    anyOf: [
                        { type: 'string', minLength: 1 },
                        {
                            type: 'array',
                            minItems: 1,
                            items: { type: 'string', minLength: 1 }
                        },
                        { type: 'number' },
                        { type: 'boolean' }
                    ]
                }
            },
            additionalProperties: false
        }
    },
    required: ['email', 'password', 'firstName', 'lastName'],
    additionalProperties: false
};

const signUpChallengeSchema = {
    type: 'object',
    properties: {
        continuationToken: { type: 'string', minLength: 10 }
    },
    required: ['continuationToken'],
    additionalProperties: false
};

const signUpContinueSchema = {
    type: 'object',
    properties: {
        continuationToken: { type: 'string', minLength: 10 },
        grantType: { type: 'string', enum: ['oob', 'password'] },
        code: { type: 'string', minLength: 4 },
        password: { type: 'string', minLength: 6 }
    },
    required: ['continuationToken', 'grantType'],
    additionalProperties: false,
    allOf: [
        {
            if: {
                properties: {
                    grantType: { const: 'oob' }
                }
            },
            then: {
                required: ['code']
            }
        },
        {
            if: {
                properties: {
                    grantType: { const: 'password' }
                }
            },
            then: {
                required: ['password']
            }
        }
    ]
};

const passwordResetStartSchema = {
    type: 'object',
    properties: {
        username: { type: 'string', minLength: 3 }
    },
    required: ['username'],
    additionalProperties: false
};

const passwordResetContinueSchema = {
    type: 'object',
    properties: {
        continuationToken: { type: 'string', minLength: 10 },
        grantType: { type: 'string', enum: ['oob', 'password'] },
        code: { type: 'string', minLength: 4 },
        newPassword: { type: 'string', minLength: 6 }
    },
    required: ['continuationToken', 'grantType'],
    additionalProperties: false,
    allOf: [
        {
            if: {
                properties: {
                    grantType: { const: 'oob' }
                }
            },
            then: {
                required: ['code']
            }
        },
        {
            if: {
                properties: {
                    grantType: { const: 'password' }
                }
            },
            then: {
                required: ['newPassword']
            }
        }
    ]
};

export const schemas = {
    signIn: signInSchema,
    signUpStart: signUpStartSchema,
    signUpChallenge: signUpChallengeSchema,
    signUpContinue: signUpContinueSchema,
    passwordResetStart: passwordResetStartSchema,
    passwordResetContinue: passwordResetContinueSchema
};

export const validators = {
    signIn: ajv.compile(signInSchema),
    signUpStart: ajv.compile(signUpStartSchema),
    signUpChallenge: ajv.compile(signUpChallengeSchema),
    signUpContinue: ajv.compile(signUpContinueSchema),
    passwordResetStart: ajv.compile(passwordResetStartSchema),
    passwordResetContinue: ajv.compile(passwordResetContinueSchema)
};
