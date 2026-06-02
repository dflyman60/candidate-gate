const STORAGE_KEY = "candidateGate.v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return normalizeState(data);
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultState() {
  return { version: 1, requisitions: [] };
}

function normalizeState(data) {
  return {
    version: data.version || 1,
    requisitions: Array.isArray(data.requisitions) ? data.requisitions : [],
  };
}

export function uuid() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getRequisition(state, id) {
  return state.requisitions.find((r) => r.id === id) || null;
}

export function upsertRequisition(state, req) {
  const idx = state.requisitions.findIndex((r) => r.id === req.id);
  const next = { ...state };
  if (idx >= 0) {
    next.requisitions = [...state.requisitions];
    next.requisitions[idx] = req;
  } else {
    next.requisitions = [req, ...state.requisitions];
  }
  return next;
}

export function deleteRequisition(state, id) {
  return {
    ...state,
    requisitions: state.requisitions.filter((r) => r.id !== id),
  };
}
