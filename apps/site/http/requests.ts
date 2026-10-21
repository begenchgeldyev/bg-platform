export function errorResponse(status: number, error: string, headers?: Record<string, string>) {
  return Response.json({ error }, { status, headers });
}

export async function readBodyWithin(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) {
    return '';
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Bun.concatArrayBuffers(chunks));
}

// A page on another site can still fire "simple" text/plain POSTs at an endpoint from every visitor's browser.
// Requiring JSON forces a CORS preflight, which this server never answers, so those requests never reach a handler.
export function refuseCrossSite(req: Request): Response | null {
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return errorResponse(403, 'cross-site requests are not allowed');
  }
  return null;
}

export function refuseNonJson(req: Request): Response | null {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return errorResponse(415, 'requests must be JSON');
  }
  return null;
}

export async function readJsonWithin(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) {
    return { ok: false, response: errorResponse(400, 'request is too large') };
  }
  const raw = await readBodyWithin(req, maxBytes);
  if (raw === null) {
    return { ok: false, response: errorResponse(400, 'request is too large') };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: errorResponse(400, 'request body must be JSON') };
  }
}
