"use strict";
(() => {
  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 9e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title2 = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title2 || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head2 = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head2 && base) {
        next.branches = { head: head2, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var HostRequestError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    let resolveHandler = null;
    let actionHandler = null;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key) => {
          const result = await storage({ op: "get", key });
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value) => {
          await storage({ op: "set", key, value });
        },
        delete: async (key) => {
          await storage({ op: "delete", key });
        },
        keys: async () => {
          const result = await storage({ op: "keys" });
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        target.removeEventListener("message", onMessage);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
      }
    };
  };

  // page/main.ts
  var L = {
    zh: {
      title: "DeepSeek \u7528\u91CF\u770B\u677F",
      refresh: "\u5237\u65B0",
      peak: "\u5CF0\u65F6",
      offpeak: "\u8C37\u65F6",
      switchesIn: (time, next) => `\u8DDD\u5207\u6362 ${time} \u2192 ${next}`,
      balance: "\u4F59\u989D",
      today: "\u4ECA\u65E5\u8D39\u7528\uFF08\u5B98\u65B9\u4EF7\uFF09",
      d30: "\u8FD1 30 \u5929\uFF08\u5B98\u65B9\u4EF7\uFF09",
      d30recorded: "\u8FD1 30 \u5929\uFF08OpenCode \u8BB0\u8D26\uFF09",
      allTime: "\u7D2F\u8BA1\uFF08\u5B98\u65B9\u4EF7\uFF09",
      calls: (n) => `${n} \u6B21`,
      calendar: "\u6BCF\u65E5\u8D39\u7528\uFF08\u8FD1 12 \u5468\uFF09",
      less: "\u5C11",
      more: "\u591A",
      ranking: "\u4F1A\u8BDD\u6392\u884C\uFF08\u8FD1 30 \u5929\uFF0C\u542B\u5B50\u4EE3\u7406\uFF09",
      noData: "\u6682\u65E0\u6570\u636E",
      openFailed: (msg) => `\u6253\u5F00\u4F1A\u8BDD\u5931\u8D25\uFF1A${msg}`,
      updatedAt: (time) => `\u66F4\u65B0\u4E8E ${time}`,
      loadFailed: (msg) => `\u52A0\u8F7D\u5931\u8D25\uFF1A${msg}`,
      retry: "\u91CD\u8BD5",
      fxNote: (rate, src) => `OpenCode \u8BB0\u8D26\u6309\u6C47\u7387 1 USD = \xA5${rate} \u6298\u7B97\uFF08${src}\uFF09`,
      note: "\u5B98\u65B9\u4EF7\u6309\u4EBA\u6C11\u5E01\u4EF7\u76EE\u4E0E\u5CF0\u8C37\u65F6\u6BB5\u9010\u6761\u91CD\u7B97\uFF1B\u70B9\u51FB\u4F1A\u8BDD\u884C\u53EF\u8DF3\u8F6C\u5230\u8BE5\u4F1A\u8BDD"
    },
    en: {
      title: "DeepSeek Usage Dashboard",
      refresh: "Refresh",
      peak: "peak",
      offpeak: "off-peak",
      switchesIn: (time, next) => `switches in ${time} \u2192 ${next}`,
      balance: "Balance",
      today: "Today's cost (official)",
      d30: "Last 30 days (official)",
      d30recorded: "Last 30 days (OpenCode recorded)",
      allTime: "All time (official)",
      calls: (n) => `${n} calls`,
      calendar: "Daily cost (last 12 weeks)",
      less: "less",
      more: "more",
      ranking: "Sessions by cost (last 30 days, incl. subagents)",
      noData: "No data",
      openFailed: (msg) => `Could not open session: ${msg}`,
      updatedAt: (time) => `updated ${time}`,
      loadFailed: (msg) => `Load failed: ${msg}`,
      retry: "Retry",
      fxNote: (rate, src) => `OpenCode recorded converted at 1 USD = \xA5${rate} (${src})`,
      note: "Official cost recomputed per message using the CNY price list and peak windows; click a session row to open it."
    }
  };
  var MOCK = new URLSearchParams(location.search).has("mock");
  function detectLang(locale) {
    return locale && locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  var lang = detectLang(MOCK ? new URLSearchParams(location.search).get("lang") ?? navigator.language : navigator.language);
  var T = () => L[lang];
  var host = connectHost();
  var root = document.querySelector("#root");
  var mounted = false;
  var lastSummary = null;
  var lastSessions = [];
  var el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  };
  var totalTokens = (t) => t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
  function fmtTokens(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(Math.round(n));
  }
  function fmtCny(n) {
    if (n >= 100) return `\xA5${n.toFixed(1)}`;
    if (n >= 1) return `\xA5${n.toFixed(2)}`;
    return `\xA5${n.toFixed(3)}`;
  }
  var fmtInt = (n) => Math.round(n).toLocaleString("en-US");
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1e3));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const ss = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  function localDateStr(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtDateTime(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  var page = el("div", "page");
  var head = el("div", "head");
  var title = el("div", "title", T().title);
  var headRight = el("div", "head-right");
  var peakBadge = el("div", "peak-badge");
  var updated = el("div", "small muted");
  var headSpacer = el("div", "small muted");
  var cards = el("div", "cards");
  var calendarSection = el("div", "section", T().calendar);
  var heatWrap = el("div", "heat-wrap");
  var heat = el("div", "heat");
  var legend = el("div", "legend");
  var rankingSection = el("div", "section", T().ranking);
  var rows = el("div", "rows");
  var foot = el("div", "foot");
  headRight.append(peakBadge, updated);
  head.append(title, headRight);
  heatWrap.append(heat, legend);
  page.append(head, cards, calendarSection, heatWrap, rankingSection, rows, foot);
  root.append(page);
  async function loadData() {
    if (MOCK) {
      const summary2 = mockSummary();
      return { summary: summary2, sessions: mockSessions() };
    }
    const [summaryRes, sessionsRes] = await Promise.all([
      host.serviceRequest({ method: "GET", path: "/summary", query: { days: "90" } }),
      host.serviceRequest({ method: "GET", path: "/sessions", query: { days: "30", limit: "15" } })
    ]);
    const summary = JSON.parse(summaryRes.body);
    const sessions = JSON.parse(sessionsRes.body);
    return { summary, sessions: sessions.ok ? sessions.sessions : [] };
  }
  function statCard(label, value, sub) {
    const card = el("div", "card");
    card.append(el("div", "k", label), el("div", "v", value));
    if (sub) card.append(el("div", "sub", sub));
    return card;
  }
  function sumDays(list) {
    let official = 0;
    let cost = 0;
    let requests = 0;
    for (const d of list) {
      official += d.official;
      cost += d.cost;
      requests += d.requests;
    }
    return { official, cost, requests };
  }
  function renderHead(s) {
    const t = T();
    peakBadge.textContent = `${s.now.isPeak ? t.peak : t.offpeak} \xB7 ${t.switchesIn(countdown(s.now.nextChangeAt - Date.now()), s.now.nextPhase === "peak" ? t.peak : t.offpeak)}`;
    updated.textContent = t.updatedAt(new Date(s.generatedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", { hour12: false }));
  }
  function renderCards(s) {
    const t = T();
    const last30 = (s.days ?? []).slice(-30);
    const agg30 = sumDays(last30);
    const balance = s.balance?.ok ? `${s.balance.currency === "CNY" ? "\xA5" : ""}${s.balance.total ?? "\u2014"}` : "\u2014";
    cards.replaceChildren(
      statCard(t.balance, balance, s.balance?.ok ? void 0 : s.balance?.reason === "no-key" ? "no key" : void 0),
      statCard(t.today, fmtCny(s.today?.official ?? 0), s.today ? t.calls(fmtInt(s.today.requests)) : t.noData),
      statCard(t.d30, fmtCny(agg30.official), t.calls(fmtInt(agg30.requests))),
      statCard(t.d30recorded, fmtCny(agg30.cost)),
      statCard(t.allTime, fmtCny(s.totals?.official ?? 0), s.totals ? `${fmtTokens(totalTokens(s.totals.tokens))} tokens` : void 0)
    );
  }
  function renderHeat(s) {
    const t = T();
    const days = s.days ?? [];
    const map = new Map(days.map((d) => [d.date, d.official]));
    const max = Math.max(1e-9, ...days.map((d) => d.official));
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(start.getDate() - mondayOffset - 11 * 7);
    const cells = [];
    for (let i = 0; i < 12 * 7; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = localDateStr(d);
      const cost = map.get(key) ?? 0;
      const cell = el("div", "cell");
      if (cost > 0) {
        const level = Math.min(4, 1 + Math.floor(cost / max * 3.999));
        cell.classList.add(`l${level}`);
      }
      if (d.getTime() > today.getTime()) cell.style.visibility = "hidden";
      cell.title = `${key} \xB7 ${fmtCny(cost)}`;
      cells.push(cell);
    }
    heat.replaceChildren(...cells);
    legend.replaceChildren(
      el("span", void 0, t.less),
      ...["", "l1", "l2", "l3", "l4"].map((lv) => {
        const sw = el("span", `swatch ${lv}`.trim());
        sw.style.background = `color-mix(in srgb, currentColor ${["8", "24", "38", "54", "74"][["", "l1", "l2", "l3", "l4"].indexOf(lv)]}%, transparent)`;
        return sw;
      }),
      el("span", void 0, t.more)
    );
  }
  function renderRanking() {
    const t = T();
    if (lastSessions.length === 0) {
      rows.replaceChildren(el("div", "small muted", t.noData));
      return;
    }
    rows.replaceChildren(
      ...lastSessions.map((s, index) => {
        const row = el("div", "rank");
        row.title = s.id;
        const name = el("div", "name", s.title || s.id);
        row.append(
          el("div", "no", String(index + 1)),
          name,
          el("div", "meta", `${fmtInt(s.requests)} \xB7 ${fmtTokens(totalTokens(s.tokens))} \xB7 ${fmtDateTime(s.lastMessageAt || s.startedAt)}`),
          el("div", "val", fmtCny(s.official))
        );
        row.addEventListener("click", () => {
          void (async () => {
            try {
              await host.openSession(s.id);
            } catch (error) {
              await host.toast({
                kind: "error",
                message: t.openFailed(error instanceof Error ? error.message : String(error)),
                dismiss: true
              });
            }
          })();
        });
        return row;
      })
    );
  }
  function renderFoot(s) {
    const t = T();
    const bits = [];
    if (s.fx) bits.push(t.fxNote(String(s.fx.usdCny), s.fx.source));
    bits.push(t.note);
    foot.replaceChildren(...bits.map((b) => el("div", void 0, b)));
  }
  function renderAll(summary, sessions) {
    lastSummary = summary;
    lastSessions = sessions;
    renderHead(summary);
    renderCards(summary);
    renderHeat(summary);
    renderRanking();
    renderFoot(summary);
  }
  function showError(error) {
    const t = T();
    cards.replaceChildren(
      statCard(
        t.loadFailed(error instanceof Error ? error.message : String(error)),
        ""
      )
    );
    const btn = el("div", "card");
    btn.style.cursor = "pointer";
    btn.textContent = t.retry;
    btn.addEventListener("click", () => void refresh());
    cards.append(btn);
  }
  var loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const { summary, sessions } = await loadData();
      renderAll(summary, sessions);
    } catch (error) {
      showError(error);
    } finally {
      loading = false;
    }
  }
  function applyLocale() {
    const t = T();
    title.textContent = t.title;
    calendarSection.textContent = t.calendar;
    rankingSection.textContent = t.ranking;
    refreshButton.textContent = `\u21BB ${t.refresh}`;
    if (lastSummary) renderAll(lastSummary, lastSessions);
  }
  var refreshButton = el("button", "peak-badge");
  refreshButton.textContent = `\u21BB ${T().refresh}`;
  refreshButton.style.cursor = "pointer";
  refreshButton.addEventListener("click", () => void refresh());
  headRight.append(refreshButton);
  function boot() {
    void refresh();
    setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, 12e4);
    setInterval(() => {
      if (lastSummary) renderHead(lastSummary);
    }, 1e3);
  }
  if (MOCK) {
    const dark = new URLSearchParams(location.search).get("theme") !== "light";
    const html = document.documentElement;
    html.style.colorScheme = dark ? "dark" : "light";
    html.style.background = dark ? "#15171c" : "#ffffff";
    html.style.color = dark ? "#e8e8ea" : "#1b1b1f";
    html.style.minHeight = "100vh";
    boot();
  } else {
    host.onReady((ctx) => {
      const next = detectLang(ctx.locale);
      if (next !== lang) {
        lang = next;
        applyLocale();
      }
      if (mounted) return;
      mounted = true;
      boot();
    });
  }
  function mockSummary() {
    const now = Date.now();
    const days = [];
    for (let i = 89; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const factor = 0.25 + i * 41 % 100 / 110;
      const input = Math.round(18e4 * factor);
      const output = Math.round(45e3 * factor);
      const reasoning = Math.round(output * 0.4);
      const cacheRead = Math.round(9e6 * factor);
      const tokens = { input, output, reasoning, cacheRead, cacheWrite: 0 };
      const official = (input * 1 + cacheRead * 0.02 + (output + reasoning) * 4) / 1e6;
      days.push({
        date: localDateStr(d),
        requests: Math.round(14 * factor),
        tokens,
        cost: official * 0.92,
        official,
        peakOfficial: official * 0.55,
        offOfficial: official * 0.45
      });
    }
    return {
      ok: true,
      generatedAt: now,
      now: { isPeak: true, nextChangeAt: now + 15e5, nextPhase: "offpeak" },
      balance: { ok: true, currency: "CNY", total: "263.85" },
      fx: { usdCny: 6.7223, source: "open.er-api.com" },
      totals: {
        requests: days.reduce((a, d) => a + d.requests, 0),
        tokens: { input: 2e7, output: 4e6, reasoning: 16e5, cacheRead: 9e8, cacheWrite: 0 },
        cost: days.reduce((a, d) => a + d.cost, 0) * 1.4,
        official: days.reduce((a, d) => a + d.official, 0) * 1.4
      },
      today: days[days.length - 1] ?? null,
      days
    };
  }
  function mockSessions() {
    const now = Date.now();
    const titles = [
      "OpenChamber \u6269\u5C55\u6E05\u5355\u67E5\u770B",
      "\u91CD\u65B0\u5BA1\u67E5\u73B0\u6709 BUG",
      "\u4E2D\u6587\u9053\u8DEF\u8FD0\u8F93\u8BC1 OCR \u8BC6\u522B\u5931\u8D25\u6392\u67E5",
      "BillController \u9700\u8865\u5145\u4FEE\u6539\u63A5\u53E3",
      "UserController \u65B0\u589E\u4FEE\u6539\u81EA\u8EAB\u5BC6\u7801\u63A5\u53E3",
      "\u9879\u76EE\u5BA1\u67E5\u4E0E\u53EF\u6539\u8FDB\u9879",
      "\u9879\u76EE\u5168\u6D41\u7A0B\u5206\u652F\u62A5\u544A",
      "PdaCargoController \u52A0\u767D\u63D0\u8D27\u2026"
    ];
    return titles.map((title2, i) => {
      const official = [16.9, 12.4, 9.8, 7.1, 5.6, 4.2, 3.1, 2.4][i];
      const requests = [1133, 842, 611, 488, 402, 291, 233, 175][i];
      return {
        id: `ses_mock_${i}`,
        title: title2,
        official,
        cost: official * 0.62,
        requests,
        tokens: { input: requests * 3200, output: requests * 1200, reasoning: requests * 500, cacheRead: requests * 9e4, cacheWrite: 0 },
        startedAt: now - (i + 1) * 36e5 * 5,
        lastMessageAt: now - (i + 1) * 36e5
      };
    });
  }
})();
