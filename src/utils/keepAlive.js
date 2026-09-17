const axios = require('axios');

function createKeepAliveScheduler({
  enabled = false,
  targetUrl,
  intervalMs = 60000,
  pingFn = null,
  logger = console,
} = {}) {
  if (!enabled) {
    logger.info?.('[keepalive] disabled');
    return null;
  }

  const normalizedTargetUrl = targetUrl?.replace(/\/$/, '');
  if (!normalizedTargetUrl) {
    logger.warn?.('[keepalive] disabled: no target URL configured');
    return null;
  }

  const safeIntervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : 60000;
  const runPing = () => {
    const request = (pingFn || defaultPingFn)(normalizedTargetUrl);

    return Promise.resolve(request)
      .then(() => logger.info?.(`[keepalive] ok ${normalizedTargetUrl}`))
      .catch((error) => logger.warn?.(`[keepalive] failed: ${error.message}`));
  };

  runPing();

  const timer = setInterval(runPing, safeIntervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop() {
      clearInterval(timer);
    },
    run() {
      return runPing();
    },
  };
}

function defaultPingFn(targetUrl) {
  return axios.get(`${targetUrl}/api/health`, { timeout: 5000 });
}

module.exports = {
  createKeepAliveScheduler,
};
