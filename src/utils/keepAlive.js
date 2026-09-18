const axios = require('axios');

/**
 * createKeepAliveScheduler — pings one or more URLs on an interval.
 *
 * @param {object} opts
 * @param {boolean}          opts.enabled
 * @param {string|string[]}  opts.targetUrl   — single URL or array of URLs
 * @param {number}           opts.intervalMs
 * @param {Function}         opts.pingFn      — optional custom ping function(url)
 * @param {object}           opts.logger
 */
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

  // Support both a single URL string and an array of URLs
  const rawUrls = Array.isArray(targetUrl) ? targetUrl : [targetUrl];
  const targets = rawUrls
    .map(u => u?.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (targets.length === 0) {
    logger.warn?.('[keepalive] disabled: no target URLs configured');
    return null;
  }

  const safeIntervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : 60000;

  const runPing = () => {
    targets.forEach(url => {
      const request = (pingFn || defaultPingFn)(url);
      Promise.resolve(request)
        .then(() => logger.info?.(`[keepalive] ok ${url}`))
        .catch((error) => logger.warn?.(`[keepalive] failed ${url}: ${error.message}`));
    });
  };

  runPing();

  const timer = setInterval(runPing, safeIntervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  logger.info?.(`[keepalive] watching ${targets.length} target(s) every ${safeIntervalMs / 1000}s`);

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
  return axios.get(`${targetUrl}/api/health`, { timeout: 8000 });
}

module.exports = {
  createKeepAliveScheduler,
};
