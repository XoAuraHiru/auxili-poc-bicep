import { useState } from "react";
import {
  createTodo,
  deleteTodo,
  getTodo,
  updateTodo,
} from "../services/todoApi.js";
import { getSubscriptionKey } from "../services/apiClient.js";

const DEFAULT_TODO_PAYLOAD = `{
  "title": "Demo todo from Auxili UI",
  "description": "Created via the React client",
  "isComplete": false
}`;

function parseJson(input) {
  try {
    return JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON payload. ${message}`);
  }
}

function formatJson(data) {
  if (data == null) {
    return "null";
  }

  if (typeof data === "string") {
    return data;
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return data.toString();
  }
}

function getCardClass(variant) {
  if (variant === "centered") {
    return "card card--centered";
  }

  if (variant === "span") {
    return "card card--span";
  }

  return "card";
}

function toSlug(value) {
  return (
    (value || "todo")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "todo"
  );
}

function TodoTester({
  title,
  description,
  token,
  variant = "span",
  requireIdForCreate = false,
  initialTodoId = "",
  initialPayload = DEFAULT_TODO_PAYLOAD,
  authModeLabel,
}) {
  const [todoId, setTodoId] = useState(initialTodoId);
  const [payload, setPayload] = useState(initialPayload);
  const [isPending, setIsPending] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [subscriptionKey, setSubscriptionKey] = useState(() => {
    return getSubscriptionKey() || "";
  });
  const idPrefix = toSlug(title);
  const todoIdFieldId = `${idPrefix}-todo-id`;
  const payloadFieldId = `${idPrefix}-todo-payload`;
  const subscriptionKeyFieldId = `${idPrefix}-subscription-key`;

  const handleAction = async (action) => {
    setIsPending(true);
    setLastResult(null);
    setLastError(null);

    try {
      const trimmedId = todoId.trim();
      const needsId = action !== "create" || requireIdForCreate;
      const resolvedSubscriptionKey = subscriptionKey.trim() || undefined;

      if (needsId && !trimmedId) {
        throw new Error("Todo ID is required for this operation.");
      }

      let parsedPayload = null;

      if (action === "create" || action === "update") {
        parsedPayload = parseJson(payload);
      }

      let response;

      switch (action) {
        case "create":
          response = await createTodo({
            todo: parsedPayload,
            token,
            subscriptionKey: resolvedSubscriptionKey,
          });
          break;
        case "get":
          response = await getTodo({
            id: trimmedId,
            token,
            subscriptionKey: resolvedSubscriptionKey,
          });
          break;
        case "update":
          response = await updateTodo({
            id: trimmedId,
            todo: parsedPayload,
            token,
            subscriptionKey: resolvedSubscriptionKey,
          });
          break;
        case "delete":
          response = await deleteTodo({
            id: trimmedId,
            token,
            subscriptionKey: resolvedSubscriptionKey,
          });
          break;
        default:
          throw new Error(`Unsupported action: ${action}`);
      }

      setLastResult({
        action,
        response,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const normalizedError = {
        message,
        status: error?.status ?? error?.data?.statusCode ?? null,
        details: error?.data ?? null,
      };
      setLastError(normalizedError);
    } finally {
      setIsPending(false);
    }
  };

  const resetPayload = () => {
    setPayload(DEFAULT_TODO_PAYLOAD);
  };

  return (
    <div className={getCardClass(variant)}>
      <header className="card__header">
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
        {authModeLabel && (
          <p className="todo-tester__auth-label">{authModeLabel}</p>
        )}
      </header>

      <div className="card__body todo-tester__body">
        <div className="form-group">
          <label htmlFor={subscriptionKeyFieldId}>APIM subscription key</label>
          <input
            id={subscriptionKeyFieldId}
            type="text"
            value={subscriptionKey}
            onChange={(event) => setSubscriptionKey(event.target.value)}
            placeholder="Paste your Ocp-Apim-Subscription-Key"
            autoComplete="off"
            disabled={isPending}
          />
          <p className="muted todo-tester__hint">
            We'll attach this value to every request as{" "}
            <code>Ocp-Apim-Subscription-Key</code>. Leave it blank to fall back
            to any globally provided <code>APIM_SUBSCRIPTION_KEY</code> (or the
            legacy <code>VITE_APIM_SUBSCRIPTION_KEY</code>).
          </p>
        </div>

        <div className="form-group">
          <label htmlFor={todoIdFieldId}>Todo ID</label>
          <input
            id={todoIdFieldId}
            type="text"
            value={todoId}
            onChange={(event) => setTodoId(event.target.value)}
            placeholder="e.g. 123"
            disabled={isPending}
          />
        </div>

        <div className="form-group">
          <label htmlFor={payloadFieldId}>Todo payload (JSON)</label>
          <textarea
            id={payloadFieldId}
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            rows={8}
            spellCheck={false}
            disabled={isPending}
          />
          <button
            type="button"
            className="btn btn--ghost todo-tester__reset"
            onClick={resetPayload}
            disabled={isPending}
          >
            Reset payload template
          </button>
        </div>

        <div className="todo-tester__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => handleAction("create")}
            disabled={isPending}
          >
            POST /todo/todos
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => handleAction("get")}
            disabled={isPending}
          >
            {"GET /todo/todos/{id}"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => handleAction("update")}
            disabled={isPending}
          >
            {"PUT /todo/todos/{id}"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => handleAction("delete")}
            disabled={isPending}
          >
            {"DELETE /todo/todos/{id}"}
          </button>
        </div>

        {isPending && (
          <p className="muted" role="status">
            Sending request...
          </p>
        )}

        {lastResult && !isPending && (
          <div className="todo-tester__result">
            <p className="muted">
              {`${lastResult.action.toUpperCase()} response (${new Date(
                lastResult.timestamp
              ).toLocaleTimeString()})`}
            </p>
            <pre className="code-block">
              <code>{formatJson(lastResult.response)}</code>
            </pre>
          </div>
        )}

        {lastError && !isPending && (
          <div className="error-block" role="alert">
            <p className="muted">Request failed</p>
            <pre className="code-block">
              <code>{formatJson(lastError)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default TodoTester;
