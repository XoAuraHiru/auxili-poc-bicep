import { apiRequest } from './apiClient.js';

function buildTodoPath(id) {
    if (!id && id !== 0) {
        throw new Error('Todo ID is required.');
    }

    const normalizedId = encodeURIComponent(String(id).trim());
    if (!normalizedId) {
        throw new Error('Todo ID is required.');
    }

    return `/todo/todos/${normalizedId}`;
}

function buildHeaders(subscriptionKey) {
    if (!subscriptionKey) {
        return undefined;
    }

    return {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
    };
}

export function createTodo({ todo, token, subscriptionKey, signal } = {}) {
    if (!todo || typeof todo !== 'object') {
        throw new Error('A todo object is required.');
    }

    return apiRequest('/todo/todos', {
        method: 'POST',
        body: todo,
        token,
        headers: buildHeaders(subscriptionKey),
        signal,
    });
}

export function getTodo({ id, token, subscriptionKey, signal } = {}) {
    const path = buildTodoPath(id);
    return apiRequest(path, {
        method: 'GET',
        token,
        headers: buildHeaders(subscriptionKey),
        signal,
    });
}

export function updateTodo({ id, todo, token, subscriptionKey, signal } = {}) {
    if (!todo || typeof todo !== 'object') {
        throw new Error('A todo object is required.');
    }

    const path = buildTodoPath(id);
    return apiRequest(path, {
        method: 'PUT',
        body: todo,
        token,
        headers: buildHeaders(subscriptionKey),
        signal,
    });
}

export function deleteTodo({ id, token, subscriptionKey, signal } = {}) {
    const path = buildTodoPath(id);
    return apiRequest(path, {
        method: 'DELETE',
        token,
        headers: buildHeaders(subscriptionKey),
        signal,
    });
}
