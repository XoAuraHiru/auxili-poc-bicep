export class NativeAuthSdkError extends Error {
    constructor(message, { status, code, subError, data } = {}) {
        super(message);
        this.name = 'NativeAuthSdkError';
        this.status = status ?? null;
        this.code = code ?? null;
        this.subError = subError ?? null;
        this.data = data ?? null;
    }
}
