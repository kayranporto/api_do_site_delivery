(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    token: '',
    clients: [],
    selectedClientId: '',
    refreshTimer: null,
    credentialTimer: null,
    oneTimeCredential: '',
    busy: false
  };

  const elements = {
    loginPanel: $('loginPanel'),
    dashboard: $('dashboard'),
    loginForm: $('loginForm'),
    adminToken: $('adminToken'),
    loginMessage: $('loginMessage'),
    connectButton: $('connectButton'),
    refreshButton: $('refreshButton'),
    logoutButton: $('logoutButton'),
    lastUpdated: $('lastUpdated'),
    connectionBadge: $('connectionBadge'),
    overallStatus: $('overallStatus'),
    serviceGrid: $('serviceGrid'),
    clientSelect: $('clientSelect'),
    toast: $('toast')
  };

  function text(element, value) {
    if (element) element.textContent = value === null || value === undefined ? '—' : String(value);
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }

  function add(parent, child) {
    parent.appendChild(child);
    return child;
  }

  function formatNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(number);
  }

  function formatDate(value) {
    if (!value) return 'Sem expiração';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Data inválida'
      : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function showToast(message) {
    text(elements.toast, message);
    elements.toast.classList.add('visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
  }

  async function apiEnvelope(path, options = {}) {
    if (!state.token) throw new Error('Sessão administrativa encerrada.');
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      headers: {
        authorization: 'Bearer ' + state.token,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || 'Falha HTTP ' + response.status;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function api(path, options = {}) {
    const payload = await apiEnvelope(path, options);
    return payload?.data ?? payload;
  }

  function hideCredentialReveal() {
    if (state.credentialTimer) window.clearTimeout(state.credentialTimer);
    state.credentialTimer = null;
    state.oneTimeCredential = '';
    const reveal = $('credentialReveal');
    const value = $('credentialValue');
    if (value) value.textContent = '';
    if (reveal) reveal.classList.add('hidden');
  }

  function revealCredential(credential, title) {
    hideCredentialReveal();
    if (!credential) return;
    state.oneTimeCredential = credential;
    text($('credentialRevealTitle'), title);
    text($('credentialValue'), credential);
    $('credentialReveal').classList.remove('hidden');
    $('credentialReveal').scrollIntoView({ behavior: 'smooth', block: 'center' });
    state.credentialTimer = window.setTimeout(() => {
      hideCredentialReveal();
      showToast('A chave foi ocultada automaticamente. Guarde-a em local seguro antes de fechar o painel.');
    }, 120_000);
  }

  function syncClientManagementFields() {
    const client = state.clients.find((item) => item.id === state.selectedClientId);
    if (!client) return;
    $('editClientRate').value = String(client.rateLimitMax);
    $('editClientWindow').value = String(client.rateLimitWindowMs);
  }

  function renderClientManagement({ syncFields = false } = {}) {
    const client = state.clients.find((item) => item.id === state.selectedClientId);
    const status = client ? clientStatus(client) : null;
    text($('selectedClientSummary'), client
      ? client.name + ' · ' + client.keyPrefix + ' · ' + status.label
      : 'Selecione uma credencial para habilitar as ações.');
    // Chaves expiradas ainda podem ser rotacionadas; somente credenciais revogadas ficam bloqueadas.
    const active = Boolean(client && !client.revokedAt);
    $('saveLimitsButton').disabled = !active;
    $('rotateClientButton').disabled = !active;
    $('revokeClientButton').disabled = !active;
    if (syncFields && client) syncClientManagementFields();
  }

  function renderClientAudit(events) {
    const root = $('clientAudit');
    root.replaceChildren();
    if (!events?.length) {
      root.appendChild(node('p', 'empty-state', 'Nenhum evento de auditoria registrado para esta credencial.'));
      return;
    }
    const labels = {
      created: 'Credencial criada',
      authenticated: 'Autenticação válida',
      rotated: 'Chave rotacionada',
      limits_updated: 'Limites atualizados',
      revoked: 'Credencial revogada'
    };
    for (const event of events) {
      const item = node('article', 'audit-item');
      add(item, node('span', 'audit-action', labels[event.action] || event.action));
      add(item, node('span', 'audit-date', formatDateTime(event.createdAt) + (event.requestId ? ' · ' + event.requestId : '')));
      add(root, item);
    }
  }

  async function loadClientAudit() {
    const clientId = state.selectedClientId;
    if (!clientId || !state.token) {
      renderClientAudit([]);
      return;
    }
    try {
      const events = await api('/api/v1/clients/' + encodeURIComponent(clientId) + '/audit?limit=30');
      if (state.selectedClientId === clientId) renderClientAudit(events);
    } catch (error) {
      if (state.selectedClientId !== clientId) return;
      const root = $('clientAudit');
      root.replaceChildren(node('p', 'empty-state', error.message || 'Não foi possível consultar a auditoria.'));
    }
  }

  async function publicApi(path) {
    const response = await fetch(path, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !(path === '/readyz' && response.status === 503)) {
      const error = new Error(payload?.error?.message || 'Falha HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function clearSession() {
    hideCredentialReveal();
    state.token = '';
    state.clients = [];
    state.selectedClientId = '';
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    elements.dashboard.classList.add('hidden');
    elements.loginPanel.classList.remove('hidden');
    elements.adminToken.value = '';
    elements.loginMessage.textContent = '';
    elements.loginMessage.className = 'form-message';
    text(elements.connectionBadge, 'Desconectado');
    elements.adminToken.focus();
  }

  function setConnection(connected, label) {
    elements.connectionBadge.className = connected ? 'connection-badge' : 'connection-badge status-bad';
    elements.connectionBadge.replaceChildren();
    add(elements.connectionBadge, node('span', 'status-dot'));
    add(elements.connectionBadge, node('span', '', label || (connected ? 'Conectado' : 'Desconectado')));
  }

  function renderServices(health, readiness) {
    const items = [
      { name: 'API HTTP', description: 'Liveness do processo', status: health?.status === 'ok' ? 'online' : 'offline' },
      ...Object.entries(readiness?.checks ?? {}).map(([name, value]) => ({
        name: name === 'rateLimitStore' ? 'Redis / Rate limit' : name === 'postgres' ? 'PostgreSQL' : name,
        description: 'Verificação de readiness',
        status: value === 'ok' ? 'online' : 'offline'
      }))
    ];
    if (items.length === 1) {
      items.push({ name: 'PostgreSQL', description: 'Não configurado ou não verificado', status: 'unknown' });
      items.push({ name: 'Redis', description: 'Não configurado ou não verificado', status: 'unknown' });
    }
    elements.serviceGrid.replaceChildren();
    for (const item of items) {
      const card = node('article', 'service-card');
      const info = node('div');
      add(info, node('div', 'service-name', item.name));
      add(info, node('div', 'service-description', item.description));
      const stateBox = node('span', 'service-state ' + (
        item.status === 'online' ? 'state-online' : item.status === 'offline' ? 'state-offline' : 'state-unknown'
      ));
      add(stateBox, node('span', 'status-dot'));
      add(stateBox, node('span', '', item.status === 'online' ? 'Operacional' : item.status === 'offline' ? 'Indisponível' : 'Não verificado'));
      add(card, info);
      add(card, stateBox);
      add(elements.serviceGrid, card);
    }
    const ready = readiness?.status === 'ready' && health?.status === 'ok';
    elements.overallStatus.className = 'overall-status ' + (ready ? 'status-good' : readiness?.status === 'not_ready' ? 'status-bad' : 'status-neutral');
    elements.overallStatus.replaceChildren();
    add(elements.overallStatus, node('span', 'status-dot'));
    add(elements.overallStatus, node('span', '', ready ? 'Serviços prontos' : readiness?.status === 'not_ready' ? 'Dependência indisponível' : 'Prontidão parcial'));
  }

  function renderPerformance(performance) {
    text($('kpiRequests'), formatNumber(performance?.totalRequests));
    text($('kpiLatency'), formatNumber(performance?.latencyMs?.p95, 1) + ' ms');
    text($('kpiErrors'), formatNumber(performance?.serverErrors));
    text($('kpiErrorRate'), formatNumber(performance?.errorRatePercent, 2) + '% de respostas 5xx');
    text($('kpiMemory'), formatNumber(performance?.process?.memoryMb?.rss, 1) + ' MB');
    text($('performanceWindow'), 'Janela de ' + (performance?.windowMinutes ?? 5) + ' minutos');

    const breakdown = $('statusBreakdown');
    breakdown.replaceChildren();
    const statuses = Object.entries(performance?.byStatus ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (!statuses.length) {
      breakdown.appendChild(node('p', 'empty-state', 'Nenhuma resposta concluída na janela.'));
    }
    const maxCount = Math.max(1, ...statuses.map(([, count]) => Number(count)));
    for (const [status, count] of statuses) {
      const line = node('div', 'status-line');
      add(line, node('span', 'status-code', status));
      const track = node('div', 'status-track');
      const fill = node('div', 'status-fill ' + (status.startsWith('2') ? 'good' : status.startsWith('4') ? 'warning' : status.startsWith('5') ? 'bad' : ''));
      fill.style.width = (Math.max(0, Number(count)) / maxCount * 100) + '%';
      add(track, fill);
      add(line, track);
      add(line, node('span', 'status-count', formatNumber(count)));
      add(breakdown, line);
    }

    const routeTable = $('routeTable');
    routeTable.replaceChildren();
    const routes = performance?.byRoute ?? [];
    if (!routes.length) {
      const row = node('tr');
      const cell = node('td', 'empty-state', 'Nenhuma rota registrada na janela.');
      cell.colSpan = 4;
      add(row, cell);
      add(routeTable, row);
    } else {
      for (const route of routes) {
        const row = node('tr');
        add(row, node('td', '', route.method + ' ' + route.route));
        add(row, node('td', 'numeric', formatNumber(route.requests)));
        add(row, node('td', 'numeric', formatNumber(route.errors5xx)));
        add(row, node('td', 'numeric', formatNumber(route.averageLatencyMs, 1) + ' ms'));
        add(routeTable, row);
      }
    }
  }

  function renderAlerts(alerts) {
    const active = $('activeAlerts');
    active.replaceChildren();
    const items = alerts?.alerts ?? [];
    text($('alertStatus'), alerts?.status === 'firing' ? items.length + ' alertas ativos' : 'Nenhum alerta ativo');
    if (!items.length) {
      active.appendChild(node('p', 'empty-state', 'Nenhuma regra de alerta está disparando.'));
      return;
    }
    for (const alert of items) {
      const item = node('article', 'alert-item');
      const top = node('div', 'alert-top');
      add(top, node('span', 'alert-code', alert.code));
      add(top, node('span', 'severity severity-' + (alert.severity === 'critical' ? 'critical' : 'warning'), alert.severity));
      add(item, top);
      add(item, node('p', 'alert-message', alert.message));
      add(item, node('div', 'alert-meta', 'Observado: ' + formatNumber(alert.observed, 2) + ' · Limite: ' + formatNumber(alert.threshold, 2)));
      add(active, item);
    }
  }

  function renderAlertHistory(history) {
    const root = $('alertHistory');
    root.replaceChildren();
    if (!history?.length) {
      root.appendChild(node('p', 'empty-state', 'Nenhuma transição de alerta registrada nesta instância.'));
      return;
    }
    for (const event of history) {
      const item = node('article', 'history-item');
      const top = node('div', 'history-top');
      add(top, node('span', 'alert-code', event.code));
      const label = event.status === 'resolved' ? 'Resolvido' : event.status === 'reminder' ? 'Lembrete' : 'Disparado';
      add(top, node('span', 'history-status ' + event.status, label));
      add(item, top);
      add(item, node('div', 'history-meta', formatDateTime(event.timestamp) + ' · ' + (event.severity ?? 'warning')));
      add(root, item);
    }
  }

  function clientStatus(client) {
    if (client.revokedAt) return { label: 'Revogada', className: 'pill-revoked' };
    if (client.expiresAt && new Date(client.expiresAt).getTime() <= Date.now()) {
      return { label: 'Expirada', className: 'pill-expired' };
    }
    return { label: 'Ativa', className: 'pill-active' };
  }

  function renderClients(clients) {
    state.clients = Array.isArray(clients) ? clients : [];
    text($('clientCount'), formatNumber(state.clients.length) + ' credenciais');
    const table = $('clientTable');
    table.replaceChildren();
    const select = elements.clientSelect;
    const previous = state.selectedClientId;
    select.replaceChildren();
    add(select, new Option('Selecione uma credencial', ''));
    for (const client of state.clients) {
      const status = clientStatus(client);
      const row = node('tr');
      const nameCell = node('td');
      add(nameCell, node('span', 'client-name', client.name));
      add(nameCell, node('span', 'client-prefix', client.keyPrefix));
      add(row, nameCell);
      add(row, node('td')).appendChild(node('span', 'pill ' + status.className, status.label));
      add(row, node('td', 'numeric', formatNumber(client.rateLimitMax) + ' / ' + Math.round(client.rateLimitWindowMs / 1000) + 's'));
      add(row, node('td', '', formatDate(client.expiresAt)));
      add(table, row);
      add(select, new Option(client.name + ' · ' + client.keyPrefix, client.id));
    }
    if (!state.clients.length) {
      const row = node('tr');
      const cell = node('td', 'empty-state', 'Nenhuma credencial cadastrada.');
      cell.colSpan = 4;
      add(row, cell);
      add(table, row);
      state.selectedClientId = '';
      text($('usageTotal'), '—');
      text($('usageCaption'), 'Nenhuma credencial disponível');
      $('usageChart').replaceChildren(node('p', 'empty-state', 'Crie uma credencial para acompanhar o consumo.'));
      renderClientManagement();
      renderClientAudit([]);
      return;
    }
    const hasPrevious = state.clients.some((client) => client.id === previous);
    state.selectedClientId = hasPrevious ? previous : state.clients[0].id;
    select.value = state.selectedClientId;
    renderClientManagement({ syncFields: state.selectedClientId !== previous });
  }

  function renderUsage(usage) {
    text($('usageTotal'), formatNumber(usage?.totalRequests));
    text($('usageCaption'), 'Requisições nos últimos ' + (usage?.days ?? 30) + ' dias');
    const chart = $('usageChart');
    chart.replaceChildren();
    const daily = usage?.daily ?? [];
    const max = Math.max(1, ...daily.map((item) => Number(item.requests)));
    for (const item of daily) {
      const column = node('div', 'usage-column');
      const wrap = node('div', 'usage-bar-wrap');
      const bar = node('div', 'usage-bar');
      const count = Number(item.requests) || 0;
      bar.style.height = (count === 0 ? 2 : Math.max(4, count / max * 100)) + '%';
      bar.title = formatDate(item.date) + ': ' + formatNumber(count) + ' requisições';
      add(wrap, bar);
      add(column, wrap);
      add(column, node('span', 'usage-date', item.date?.slice(5) ?? ''));
      add(chart, column);
    }
    if (!daily.length) chart.appendChild(node('p', 'empty-state', 'Histórico de consumo indisponível.'));
  }

  function renderOperationalMetrics(metrics) {
    const states = $('executionStates');
    states.replaceChildren();
    const executionEntries = Object.entries(metrics?.executionsByStatus ?? {});
    const total = executionEntries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
    add(states, node('div', 'state-row', ''));
    states.lastChild.replaceChildren(node('span', '', 'Total de execuções'), node('strong', '', formatNumber(total)));
    for (const [status, count] of executionEntries) {
      const row = node('div', 'state-row');
      add(row, node('span', '', status));
      add(row, node('strong', '', formatNumber(count)));
      add(states, row);
    }

    const events = metrics?.events ?? {};
    const eventSummary = $('eventSummary');
    eventSummary.replaceChildren();
    const totalRow = node('div', 'state-row');
    add(totalRow, node('span', '', 'Eventos na janela'));
    add(totalRow, node('strong', '', formatNumber(events.total ?? 0)));
    add(eventSummary, totalRow);
    for (const [severity, count] of Object.entries(events.bySeverity ?? {})) {
      const row = node('div', 'state-row');
      add(row, node('span', '', 'Severidade: ' + severity));
      add(row, node('strong', '', formatNumber(count)));
      add(eventSummary, row);
    }
    for (const [type, count] of Object.entries(events.byType ?? {})) {
      const row = node('div', 'state-row');
      add(row, node('span', '', type));
      add(row, node('strong', '', formatNumber(count)));
      add(eventSummary, row);
    }
    if (!executionEntries.length) states.appendChild(node('p', 'empty-state', 'Nenhuma execução contabilizada.'));
    if (!events.total) eventSummary.appendChild(node('p', 'empty-state', 'Nenhum evento registrado na janela.'));
  }

  async function loadUsage(clientId) {
    if (!clientId || !state.token) return;
    const usage = await api('/api/v1/clients/' + encodeURIComponent(clientId) + '/usage?days=30');
    renderUsage(usage);
  }

  async function refreshDashboard() {
    if (!state.token || state.busy) return;
    state.busy = true;
    elements.refreshButton.disabled = true;
    elements.refreshButton.textContent = 'Atualizando…';
    try {
      const results = await Promise.allSettled([
        publicApi('/health'),
        publicApi('/readyz'),
        api('/api/v1/observability/performance?windowMinutes=5'),
        api('/api/v1/observability/alerts?windowMinutes=5'),
        api('/api/v1/observability/metrics?windowHours=24'),
        api('/api/v1/clients')
      ]);
      const [health, readiness, performance, alerts, operations, clients] = results;
      if (clients.status === 'rejected' && clients.reason?.status === 401) {
        clearSession();
        showToast('Credencial inválida ou expirada. Entre novamente.');
        return;
      }
      if (health.status === 'fulfilled' || readiness.status === 'fulfilled') {
        renderServices(
          health.status === 'fulfilled' ? health.value : null,
          readiness.status === 'fulfilled' ? readiness.value : null
        );
      }
      if (performance.status === 'fulfilled') renderPerformance(performance.value);
      else showToast('Não foi possível atualizar as métricas HTTP.');
      if (alerts.status === 'fulfilled') renderAlerts(alerts.value);
      if (operations.status === 'fulfilled') renderOperationalMetrics(operations.value);
      try {
        renderAlertHistory(await api('/api/v1/observability/alerts/history?limit=30'));
      } catch {
        showToast('Não foi possível consultar o histórico recente de alertas.');
      }
      if (clients.status === 'fulfilled') {
        renderClients(clients.value);
        if (state.selectedClientId) {
          try {
            await Promise.all([loadUsage(state.selectedClientId), loadClientAudit()]);
          } catch { showToast('Não foi possível carregar os detalhes da credencial selecionada.'); }
        }
      }
      text(elements.lastUpdated, 'Atualizado às ' + new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date()));
      setConnection(true, 'Conectado');
    } catch (error) {
      showToast(error.message || 'Falha ao atualizar o painel.');
    } finally {
      state.busy = false;
      elements.refreshButton.disabled = false;
      elements.refreshButton.textContent = 'Atualizar';
    }
  }

  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const candidate = elements.adminToken.value.trim();
    if (candidate.length < 32) {
      text(elements.loginMessage, 'Informe uma credencial master válida.');
      return;
    }
    elements.connectButton.disabled = true;
    elements.connectButton.textContent = 'Validando…';
    text(elements.loginMessage, '');
    try {
      const response = await fetch('/api/v1/clients', {
        headers: { authorization: 'Bearer ' + candidate },
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Credencial sem acesso administrativo.');
      }
      state.token = candidate;
      elements.adminToken.value = '';
      elements.loginPanel.classList.add('hidden');
      elements.dashboard.classList.remove('hidden');
      setConnection(true, 'Conectado');
      await refreshDashboard();
      if (state.refreshTimer) window.clearInterval(state.refreshTimer);
      state.refreshTimer = window.setInterval(refreshDashboard, 30_000);
    } catch (error) {
      text(elements.loginMessage, error.message || 'Não foi possível autenticar.');
      elements.loginMessage.className = 'form-message';
      state.token = '';
    } finally {
      elements.connectButton.disabled = false;
      elements.connectButton.textContent = 'Entrar no painel';
    }
  });

  elements.refreshButton.addEventListener('click', refreshDashboard);
  elements.logoutButton.addEventListener('click', () => {
    clearSession();
    showToast('Sessão encerrada. A credencial foi removida da memória.');
  });
  elements.clientSelect.addEventListener('change', async (event) => {
    state.selectedClientId = event.target.value;
    renderClientManagement({ syncFields: true });
    if (!state.selectedClientId) {
      renderClientAudit([]);
      return;
    }
    try {
      await Promise.all([loadUsage(state.selectedClientId), loadClientAudit()]);
    } catch (error) { showToast(error.message || 'Falha ao carregar os detalhes da credencial.'); }
  });

  $('createClientForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('createClientMessage');
    const scopes = [...form.querySelectorAll('[data-scope]:checked')].map((input) => input.value);
    const globalAccess = $('newClientGlobalAccess').checked;
    const integrationIds = $('newClientIntegrationIds').value
      .split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    const uniqueIntegrationIds = [...new Set(integrationIds)];
    if (!scopes.length) {
      text(message, 'Selecione ao menos uma permissão.');
      return;
    }
    if (scopes.includes('observability:read') && !globalAccess) {
      text(message, 'O escopo de métricas exige marcar acesso global a todas as integrações.');
      return;
    }
    const body = {
      name: form.elements.name.value.trim(),
      scopes,
      integrationIds: globalAccess ? null : uniqueIntegrationIds,
      expiresInDays: Number(form.elements.expiresInDays.value),
      rateLimitMax: Number(form.elements.rateLimitMax.value),
      rateLimitWindowMs: Number(form.elements.rateLimitWindowMs.value)
    };
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    text(message, 'Criando credencial…');
    try {
      const result = await apiEnvelope('/api/v1/clients', { method: 'POST', body });
      if (result.data?.id) {
        state.selectedClientId = result.data.id;
        $('editClientRate').value = String(result.data.rateLimitMax);
        $('editClientWindow').value = String(result.data.rateLimitWindowMs);
      }
      revealCredential(result.credential, 'Credencial criada');
      text(message, 'Credencial criada. Copie a chave antes de ocultá-la.');
      showToast('Credencial criada com sucesso.');
      await refreshDashboard();
    } catch (error) {
      text(message, error.message || 'Não foi possível criar a credencial.');
    } finally {
      submit.disabled = false;
    }
  });

  $('limitsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedClientId) return;
    const form = event.currentTarget;
    $('saveLimitsButton').disabled = true;
    try {
      await api('/api/v1/clients/' + encodeURIComponent(state.selectedClientId) + '/limits', {
        method: 'POST',
        body: {
          rateLimitMax: Number(form.elements.rateLimitMax.value),
          rateLimitWindowMs: Number(form.elements.rateLimitWindowMs.value)
        }
      });
      text($('manageClientMessage'), 'Limites atualizados.');
      showToast('Limites da credencial atualizados.');
      await refreshDashboard();
    } catch (error) {
      text($('manageClientMessage'), error.message || 'Não foi possível atualizar os limites.');
    } finally {
      renderClientManagement();
    }
  });

  $('rotateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedClientId) return;
    const expiresInDays = Number(event.currentTarget.elements.expiresInDays.value);
    const selected = state.clients.find((client) => client.id === state.selectedClientId);
    if (!window.confirm('Rotacionar a chave de ' + (selected?.name || 'esta credencial') + '? A chave anterior será invalidada imediatamente e não poderá ser recuperada.')) return;
    $('rotateClientButton').disabled = true;
    try {
      const result = await apiEnvelope('/api/v1/clients/' + encodeURIComponent(state.selectedClientId) + '/rotate', {
        method: 'POST',
        body: { expiresInDays }
      });
      revealCredential(result.credential, 'Nova chave após rotação');
      text($('manageClientMessage'), 'Chave rotacionada. A chave anterior foi invalidada imediatamente.');
      showToast('Chave rotacionada. Guarde o novo segredo agora.');
      await refreshDashboard();
    } catch (error) {
      text($('manageClientMessage'), error.message || 'Não foi possível rotacionar a chave.');
    } finally {
      renderClientManagement();
    }
  });

  $('revokeClientButton').addEventListener('click', async () => {
    if (!state.selectedClientId) return;
    const selected = state.clients.find((client) => client.id === state.selectedClientId);
    if (!window.confirm('Revogar permanentemente o acesso de ' + (selected?.name || 'esta credencial') + '? A ação não pode ser desfeita.')) return;
    $('revokeClientButton').disabled = true;
    try {
      await api('/api/v1/clients/' + encodeURIComponent(state.selectedClientId) + '/revoke', { method: 'POST' });
      hideCredentialReveal();
      text($('manageClientMessage'), 'Credencial revogada. O acesso foi bloqueado.');
      showToast('Credencial revogada.');
      await refreshDashboard();
    } catch (error) {
      text($('manageClientMessage'), error.message || 'Não foi possível revogar a credencial.');
    } finally {
      renderClientManagement();
    }
  });

  $('hideCredentialButton').addEventListener('click', hideCredentialReveal);
  $('copyCredentialButton').addEventListener('click', async () => {
    if (!state.oneTimeCredential) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('A cópia automática não está disponível neste navegador.');
      await navigator.clipboard.writeText(state.oneTimeCredential);
      showToast('Chave copiada. Guarde-a em um cofre seguro.');
    } catch (error) {
      showToast(error.message || 'Não foi possível copiar. Selecione a chave e copie manualmente.');
    }
  });

  $('newClientGlobalAccess').addEventListener('change', (event) => {
    const textarea = $('newClientIntegrationIds');
    textarea.disabled = event.target.checked;
    if (event.target.checked) textarea.value = '';
  });

  window.addEventListener('beforeunload', () => {
    hideCredentialReveal();
    state.token = '';
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  });
})();