/**
 * services/conversationsAdapter.js
 *
 * Raw HTTP layer for AddSearch AI Conversations API.
 * ALL fetch() calls for AI Conversations go through this file.
 * Returns raw Response objects. Normalization happens in conversationsService.
 *
 * Reads API config via getConfig() at call time (not import time)
 * so that loadConfig() changes are reflected immediately.
 */

import { getConfig } from '../config/app.config';

var _abortController = null;

/**
 * Start a new conversation or send a follow-up.
 */
export function fetchConversation(question, conversationId, streaming) {
  abort();
  _abortController = new AbortController();

  var config = getConfig();
  var url = config.proxyUrls.conversations;
  if (streaming) {
    url += (url.includes('?') ? '&' : '?') + 'stream=true';
  }

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: question,
      conversationId: conversationId || undefined,
      siteKey: config.siteKey || undefined,
      tags: config.tags || undefined,
    }),
    signal: _abortController.signal,
  });
}

/**
 * Call the refine-query endpoint.
 */
export function fetchRefineQuery(question, conversationId) {
  var config = getConfig();
  return fetch(config.proxyUrls.refineQuery, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: question,
      conversationId: conversationId,
      siteKey: config.siteKey || undefined,
    }),
  });
}

/** Abort the current in-progress request. */
export function abort() {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
}
