/** Registra uso somente depois que autenticação e quota por cliente foram aprovadas. */
export function recordApiClientAuthentication({ apiClientRepository }) {
  return async function recordAuthentication(req, _res, next) {
    if (!req.auth?.clientId || !apiClientRepository) return next();
    try {
      await apiClientRepository.recordAudit({
        clientId: req.auth.clientId,
        action: 'authenticated',
        requestId: req.requestId,
        createdAt: new Date()
      });
    } catch {
      // Auditoria best-effort: não bloquear chave válida por indisponibilidade do log.
    }
    return next();
  };
}
