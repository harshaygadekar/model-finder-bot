function nowIso() {
  return new Date().toISOString();
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  if (typeof error === 'string') {
    return {
      message: error,
      stack: null,
    };
  }

  return {
    message: error.message || String(error),
    stack: error.stack || null,
  };
}

function createStartupState() {
  return {
    environment: { status: 'pending', updatedAt: null, error: null },
    database: { status: 'pending', updatedAt: null, error: null },
    discordLogin: { status: 'pending', updatedAt: null, error: null },
    guild: { status: 'pending', updatedAt: null, error: null },
    channels: { status: 'pending', updatedAt: null, error: null },
    commands: { status: 'pending', updatedAt: null, error: null },
    deliveryWorker: { status: 'pending', updatedAt: null, error: null },
    scheduler: { status: 'pending', updatedAt: null, error: null },
    digests: { status: 'pending', updatedAt: null, error: null },
    webhook: { status: 'pending', updatedAt: null, error: null },
  };
}

function createRuntimeState() {
  return {
    startedAt: nowIso(),
    shuttingDown: false,
    shutdownAt: null,
    lastFatalError: null,
    lastUnhandledRejection: null,
    startup: createStartupState(),
  };
}

let runtimeState = createRuntimeState();

function setStartupState(component, status, details = {}) {
  if (!runtimeState.startup[component]) {
    runtimeState.startup[component] = { status: 'pending', updatedAt: null, error: null };
  }

  const { error, ...rest } = details || {};
  runtimeState.startup[component] = {
    ...runtimeState.startup[component],
    ...rest,
    status,
    error: normalizeError(error),
    updatedAt: nowIso(),
  };

  return runtimeState.startup[component];
}

function markShutdown() {
  runtimeState.shuttingDown = true;
  runtimeState.shutdownAt = nowIso();
}

function markFatalError(error) {
  runtimeState.lastFatalError = {
    ...normalizeError(error),
    updatedAt: nowIso(),
  };
}

function markUnhandledRejection(error) {
  runtimeState.lastUnhandledRejection = {
    ...normalizeError(error),
    updatedAt: nowIso(),
  };
}

function getRuntimeState() {
  return JSON.parse(JSON.stringify(runtimeState));
}

function resetRuntimeStateForTests() {
  runtimeState = createRuntimeState();
}

module.exports = {
  setStartupState,
  markShutdown,
  markFatalError,
  markUnhandledRejection,
  getRuntimeState,
  resetRuntimeStateForTests,
};
