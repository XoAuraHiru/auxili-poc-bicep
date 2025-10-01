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

export function createTodo({ todo, token, signal } = {}) {
    if (!todo || typeof todo !== 'object') {
        throw new Error('A todo object is required.');
    }

    return apiRequest('/todo/todos', {
        method: 'POST',
        body: todo,
        token,
        signal,
    });
}

export function getTodo({ id, token, signal } = {}) {
    const path = buildTodoPath(id);
    return apiRequest(path, {
        method: 'GET',
        token,
        signal,
    });
}

export function updateTodo({ id, todo, token, signal } = {}) {
    if (!todo || typeof todo !== 'object') {
        throw new Error('A todo object is required.');
    }

    const path = buildTodoPath(id);
    return apiRequest(path, {
        method: 'PUT',
        body: todo,
        token,
        signal,
    });
}

export function deleteTodo({ id, token, signal } = {}) {
    const path = buildTodoPath(id);
    return apiRequest(path, {
        method: 'DELETE',
        token,
        signal,
    });
}
