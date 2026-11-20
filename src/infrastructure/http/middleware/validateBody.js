export function validateBody(schema) {
  return function validateRequestBody(req, res, next) {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'O corpo da requisição contém dados inválidos.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String),
            code: issue.code,
            message: issue.message
          })),
          requestId: req.requestId
        }
      });
    }
    req.validatedBody = parsed.data;
    return next();
  };
}
