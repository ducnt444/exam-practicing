export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that it is running and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? 'The server did not respond properly. Try again.');
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};
