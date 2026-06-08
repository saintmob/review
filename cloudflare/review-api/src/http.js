function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowOrigin = getCorsAllowOrigin(request);

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Origin, Range, X-Requested-With, X-Checkin-Device-Id, X-Checkin-Ticket',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Location',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

const WRITE_ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://review-api.saintmob.workers.dev',
  'https://review-zeta-seven.vercel.app',
]);

function isLocalPreviewOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && ['3000', '4173'].includes(url.port);
  } catch {
    return false;
  }
}

export function isAllowedWriteOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return WRITE_ALLOWED_ORIGINS.has(origin) || isLocalPreviewOrigin(origin);
}

function getCorsAllowOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return '*';

  const url = new URL(request.url);
  const requestedMethod = request.headers.get('Access-Control-Request-Method') || request.method;
  const isWriteRequest = !['GET', 'HEAD', 'OPTIONS'].includes(requestedMethod.toUpperCase());
  const isProtectedRead = url.pathname.startsWith('/api/admin/');

  if ((isWriteRequest || isProtectedRead) && !isAllowedWriteOrigin(request)) {
    return 'https://review-api.saintmob.workers.dev';
  }

  return origin;
}

export function applyCors(request, headers) {
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  return headers;
}

export function json(request, data, init = {}) {
  const headers = applyCors(request, new Headers(init.headers || {}));
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers,
  });
}

export function text(request, body, init = {}) {
  const headers = applyCors(request, new Headers(init.headers || {}));
  headers.set('Content-Type', 'text/plain; charset=utf-8');

  return new Response(body, {
    status: init.status || 200,
    headers,
  });
}

export function noContent(request) {
  return new Response(null, {
    status: 204,
    headers: applyCors(request, new Headers()),
  });
}

export function methodNotAllowed(request, methods) {
  return json(request, { error: 'Method not allowed' }, {
    status: 405,
    headers: {
      Allow: methods.join(', '),
    },
  });
}

export function notFound(request) {
  return json(request, { error: 'Not found' }, { status: 404 });
}

export function badRequest(request, message) {
  return json(request, { error: message }, { status: 400 });
}

export function withCache(headers, value) {
  headers.set('Cache-Control', value);
  return headers;
}
