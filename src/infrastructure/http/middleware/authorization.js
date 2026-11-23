export function requireMaster(req, res, next) {
  if (req.auth?.isMaster) return next();
  return res.status(403).json({
    error: { code: 'MASTER_CREDENTIAL_REQUIRED', message: 'Esta operação exige uma credencial administrativa.', requestId: req.requestId }
  });
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (req.auth?.isMaster || req.auth?.scopes?.includes(scope)) return next();
    return res.status(403).json({
      error: { code: 'INSUFFICIENT_SCOPE', message: 'A credencial não possui a permissão necessária.', requestId: req.requestId }
    });
  };
}

export function requireIntegrationAccess(req, res, next) {
  const allowed = req.auth?.integrationIds;
  if (req.auth?.isMaster || allowed === null || allowed?.includes(req.params.integrationId)) return next();
  return res.status(404).json({
    error: { code: 'RESOURCE_NOT_FOUND', message: 'Recurso não encontrado.', requestId: req.requestId }
  });
}

export function requireExecutionAccess(executionRepository) {
  return async (req, res, next) => {
    const allowed = req.auth?.integrationIds;
    if (req.auth?.isMaster || allowed === null) return next();
    const execution = await executionRepository.findById(req.params.executionId);
    if (!execution || !allowed?.includes(execution.integrationId)) {
      return res.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Recurso não encontrado.', requestId: req.requestId }
      });
    }
    return next();
  };
}
