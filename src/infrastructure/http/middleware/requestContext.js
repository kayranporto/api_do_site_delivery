import { randomUUID } from 'node:crypto';

export function requestContext(req, res, next) {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
