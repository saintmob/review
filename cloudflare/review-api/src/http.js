function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowOrigin = origin || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Origin, Range, X-Requested-With, X-Checkin-Device-Id, X-Checkin-Ticket',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Location',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function applyCors(request, headers) {
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
