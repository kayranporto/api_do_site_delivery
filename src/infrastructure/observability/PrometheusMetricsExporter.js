function escapeLabel(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function number(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function metricLine(name, value, labels = {}) {
  const entries = Object.entries(labels);
  const labelSet = entries.length
    ? '{' + entries.map(([key, item]) => key + '="' + escapeLabel(item) + '"').join(',') + '}'
    : '';
  return name + labelSet + ' ' + number(value);
}

/** Gera métricas Prometheus em formato text exposition 0.0.4. */
export function renderPrometheusMetrics(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.latencyMs || !snapshot.process) {
    throw new TypeError('Snapshot de métricas inválido.');
  }

  const lines = [
    '# HELP api_process_up Whether this API process is running.',
    '# TYPE api_process_up gauge',
    metricLine('api_process_up', 1),
    '# HELP api_process_info Static process identity.',
    '# TYPE api_process_info gauge',
    metricLine('api_process_info', 1, { instance_id: snapshot.instanceId ?? 'unknown' }),
    '# HELP api_http_requests_in_window Number of completed HTTP requests in the rolling window.',
    '# TYPE api_http_requests_in_window gauge',
    metricLine('api_http_requests_in_window', snapshot.totalRequests),
    '# HELP api_http_errors_5xx_in_window Number of HTTP 5xx responses in the rolling window.',
    '# TYPE api_http_errors_5xx_in_window gauge',
    metricLine('api_http_errors_5xx_in_window', snapshot.serverErrors),
    '# HELP api_http_errors_4xx_in_window Number of HTTP 4xx responses in the rolling window.',
    '# TYPE api_http_errors_4xx_in_window gauge',
    metricLine('api_http_errors_4xx_in_window', snapshot.clientErrors),
    '# HELP api_http_rate_limited_in_window Number of HTTP 429 responses in the rolling window.',
    '# TYPE api_http_rate_limited_in_window gauge',
    metricLine('api_http_rate_limited_in_window', snapshot.rateLimited),
    '# HELP api_http_error_rate_5xx_percent Percentage of HTTP 5xx responses in the rolling window.',
    '# TYPE api_http_error_rate_5xx_percent gauge',
    metricLine('api_http_error_rate_5xx_percent', snapshot.errorRatePercent),
    '# HELP api_http_rate_limited_percent Percentage of HTTP 429 responses in the rolling window.',
    '# TYPE api_http_rate_limited_percent gauge',
    metricLine('api_http_rate_limited_percent', snapshot.rateLimitRatePercent),
    '# HELP api_http_latency_ms Rolling-window HTTP latency percentiles.',
    '# TYPE api_http_latency_ms gauge',
    metricLine('api_http_latency_ms', snapshot.latencyMs.average, { statistic: 'average' }),
    metricLine('api_http_latency_ms', snapshot.latencyMs.p50, { quantile: '0.5' }),
    metricLine('api_http_latency_ms', snapshot.latencyMs.p95, { quantile: '0.95' }),
    metricLine('api_http_latency_ms', snapshot.latencyMs.max, { statistic: 'max' }),
    '# HELP api_http_status_responses_in_window Number of responses by HTTP status in the rolling window.',
    '# TYPE api_http_status_responses_in_window gauge'
  ];

  for (const [status, count] of Object.entries(snapshot.byStatus ?? {})) {
    if (/^[1-5][0-9]{2}$/.test(status)) {
      lines.push(metricLine('api_http_status_responses_in_window', count, { status }));
    }
  }

  lines.push(
    '# HELP api_http_route_requests_in_window Requests by bounded Express route template.',
    '# TYPE api_http_route_requests_in_window gauge'
  );
  for (const route of snapshot.byRoute ?? []) {
    lines.push(metricLine('api_http_route_requests_in_window', route.requests, {
      method: route.method,
      route: route.route
    }));
  }

  lines.push(
    '# HELP api_process_uptime_seconds Process uptime in seconds.',
    '# TYPE api_process_uptime_seconds gauge',
    metricLine('api_process_uptime_seconds', snapshot.process.uptimeSeconds),
    '# HELP api_process_cpu_usage_percent Average process CPU usage percentage since start.',
    '# TYPE api_process_cpu_usage_percent gauge',
    metricLine('api_process_cpu_usage_percent', snapshot.process.cpuPercent),
    '# HELP api_process_memory_bytes Process memory usage in bytes.',
    '# TYPE api_process_memory_bytes gauge'
  );

  for (const [kind, bytes] of Object.entries(snapshot.process.memoryBytes ?? {})) {
    if (['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'].includes(kind)) {
      lines.push(metricLine('api_process_memory_bytes', bytes, { kind }));
    }
  }

  return lines.join('\n') + '\n';
}
