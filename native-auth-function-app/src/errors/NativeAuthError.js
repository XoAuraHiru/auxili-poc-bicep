export class NativeAuthError extends Error {
    constructor(message, { status, data, rawResponse, path, params } = {}) {
        super(message);
        this.name = 'NativeAuthError';
        this.status = status;
        this.data = data ?? null;
        this.rawResponse = rawResponse ?? null;
        this.path = path ?? null;
        this.params = params ?? null;
        this.code = data?.error ?? null;
        this.subError = data?.suberror ?? data?.sub_error ?? null;
    }
}
