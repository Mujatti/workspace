/**
 * app/workspace/page.js — Guided Discovery Workspace
 *
 * Search-driven split-view: results always visible on left, AI conversation on right.
 * The search results ARE the workspace — not a step before it.
 *
 * Layout approach (Issue 2 fix):
 *   Both panels live in a single scrolling container. The left panel uses
 *   position:sticky so it stays visible as the conversation on the right grows.
 *   This means results are always level with whatever the user is reading.
 */
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { loadConfig } from '../config/app.config';
import { resolveConfigFromURL } from '../config/demoSessionLoader';
import * as orchestrator from '../orchestration/searchOrchestrator';
import { getClient } from '../services/keywordSearchService';
import { refineQuery } from '../services/refineQueryService';

import ConversationThread from '../components/ConversationThread';
import FollowUpInput from '../components/FollowUpInput';
import LoadingDots from '../components/LoadingDots';

// ══════════════════════════════════════════════════
// PAGE SHELL (config loading)
// ══════════════════════════════════════════════════

export default function WorkspacePage() {
  var [configReady, setConfigReady] = useState(false);
  var configRef = useRef(null);

  useEffect(function () {
    if (configRef.current) return;
    resolveConfigFromURL().then(function (resolved) {
      configRef.current = loadConfig(resolved.config);
      setConfigReady(true);
    });
  }, []);

  if (!configReady || !configRef.current) {
    return (
      <main className="px-page"><div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><LoadingDots /></div></main>
    );
  }

  return <WorkspaceApp config={configRef.current} />;
}

// ══════════════════════════════════════════════════
// WORKSPACE APP
// ══════════════════════════════════════════════════

function WorkspaceApp({ config }) {
  var labels = config.labels;
  var theme = config.theme;

  // Theme
  useEffect(function () {
    if (typeof document === 'undefined') return;
    var root = document.documentElement;
    if (theme.accentColor) root.style.setProperty('--accent', theme.accentColor);
    if (theme.bgColor) root.style.setProperty('--bg', theme.bgColor);
    if (theme.textColor) root.style.setProperty('--text', theme.textColor);
    if (theme.fontFamily) root.style.setProperty('--font', theme.fontFamily);
    if (theme.borderRadius) root.style.setProperty('--radius', theme.borderRadius);
  }, [theme]);

  // Shared orchestrator (AI conversation)
  var [orchState, setOrchState] = useState(orchestrator.INITIAL_STATE);
  var orchRef = useRef(orchState);
  orchRef.current = orchState;
  var getOrchState = useCallback(function () { return orchRef.current; }, []);
  var orchInit = useRef(false);
  if (!orchInit.current) { orchestrator.init(setOrchState, getOrchState); orchInit.current = true; }

  // ── Workspace state ──
  var [searchQuery, setSearchQuery] = useState('');
  var [searchResults, setSearchResults] = useState([]);
  var [searchLoading, setSearchLoading] = useState(false);
  var [totalHits, setTotalHits] = useState(0);
  var [hasSearched, setHasSearched] = useState(false);
  var [selectedSource, setSelectedSource] = useState(null);
  var [pinnedSources, setPinnedSources] = useState([]);
  var [currentTopic, setCurrentTopic] = useState('');
  var [conversationTopic, setConversationTopic] = useState('');
  var [loadingMore, setLoadingMore] = useState(false);
  var [refineLoading, setRefineLoading] = useState(false);
  // Track current search page for the client paging API
  var currentPageRef = useRef(1);

  var logoUrl = theme.logoUrl || '/add_search_logo.png';
  var hasConversation = orchState.messages.length > 0 || orchState.followUpLoading || orchState.followUpStreaming;

  // ── Search ──
  function doWorkspaceSearch(q, opts) {
    if (!q) return;
    opts = opts || {};
    setSearchLoading(true);
    setHasSearched(true);
    setCurrentTopic(q);
    currentPageRef.current = 1;

    function trySearch() {
      var client = getClient();
      if (!client) {
        setTimeout(trySearch, 300);
        return;
      }
      // Reset paging to page 1 for a fresh search
      if (client.setPaging) {
        client.setPaging(1, 10, 'relevance', 'desc');
      }
      client.search(q, function (response) {
        if (response && response.hits) {
          setSearchResults(response.hits.map(normalizeHit));
          setTotalHits(response.total_hits || 0);
        } else {
          setSearchResults([]);
          setTotalHits(0);
        }
        setSearchLoading(false);
      });
    }
    trySearch();

    // First query (from landing): auto-fire conversation.
    // Subsequent queries from the workspace search bar: do NOT auto-fire.
    if (opts.autoStartConversation) {
      setConversationTopic(q);
      orchestrator.doChatMessage(q);
    }
  }

  // Landing form submit — first query, auto-fire AI answer
  function handleLandingSearch(e) {
    if (e) e.preventDefault();
    var q = searchQuery.trim();
    if (!q) return;
    doWorkspaceSearch(q, { autoStartConversation: true });
  }

  // Workspace left-side search bar submit — update results only, do NOT touch conversation
  function handleWorkspaceSearch(e) {
    if (e) e.preventDefault();
    var q = searchQuery.trim();
    if (!q) return;
    // FIX Issue 3: Do NOT reset conversation here.
    // Only update search results. Conversation stays as-is.
    // User must click "Dive deeper" to reset + start new conversation.
    setSelectedSource(null);
    doWorkspaceSearch(q);
  }

  // Dive deeper — resets chat and starts new conversation for current topic
  // Dive deeper — resets chat and starts new conversation for current topic.
  // setTimeout is needed because resetChat() calls React setState which is async.
  // Without the defer, doChatMessage() would read the OLD state (old messages + old conversationId)
  // and append to the previous conversation instead of starting fresh.
  function diveDeeper() {
    orchestrator.resetChat();
    setPinnedSources([]);
    setSelectedSource(null);
    setConversationTopic(currentTopic);
    setTimeout(function () {
      orchestrator.doChatMessage(currentTopic);
    }, 0);
  }

  function normalizeHit(hit) {
    var thumb = hit.images ? (hit.images.main || hit.images.capture || '') : '';
    return {
      title: hit.title || '',
      url: hit.url || '',
      thumbnail: thumb,
      snippet: hit.highlight || hit.meta_description || '',
    };
  }

  // ── FIX Issue 1: Load more results using AddSearchClient.nextPage() ──
  function loadMoreResults() {
    var client = getClient();
    if (!client || loadingMore) return;
    setLoadingMore(true);

    // AddSearchClient API: nextPage() advances internal page counter,
    // then search() fetches the next page
    if (client.nextPage) {
      client.nextPage();
    }
    currentPageRef.current += 1;

    client.search(currentTopic, function (response) {
      setLoadingMore(false);
      if (response && response.hits && response.hits.length > 0) {
        var newHits = response.hits.map(normalizeHit);
        setSearchResults(function (prev) {
          // Deduplicate by URL
          var existingUrls = {};
          prev.forEach(function (r) { existingUrls[r.url] = true; });
          var unique = newHits.filter(function (r) { return !existingUrls[r.url]; });
          return prev.concat(unique);
        });
      }
    });
  }

  // ── Source management ──
  // Toggle selection — clicking selected source again deselects
  function selectSource(source) {
    setSelectedSource(function (prev) {
      if (prev && prev.url === source.url) return null;
      return source;
    });
  }

  function pinSource(source) {
    setPinnedSources(function (prev) {
      if (prev.some(function (s) { return s.url === source.url; })) return prev;
      return prev.concat([source]);
    });
  }

  function unpinSource(source) {
    setPinnedSources(function (prev) { return prev.filter(function (s) { return s.url !== source.url; }); });
  }

  function isPinned(source) {
    return pinnedSources.some(function (s) { return s.url === source.url; });
  }

  // ── Context-aware chat ──
  function sendWithContext(question) {
    var contextHint = '';
    if (selectedSource) {
      contextHint += ' [Selected source: "' + selectedSource.title + '"]';
    }
    if (pinnedSources.length > 0) {
      contextHint += ' [Pinned: ' + pinnedSources.map(function (s) { return '"' + s.title + '"'; }).join(', ') + ']';
    }
    orchestrator.doChatMessage(question + contextHint);
  }

  // ── Next actions ──
  function askAboutSource(source) {
    selectSource(source);
    sendWithContext('Tell me more about: ' + source.title);
  }

  function comparePinned() {
    if (pinnedSources.length < 2) return;
    var names = pinnedSources.map(function (s) { return '"' + s.title + '"'; }).join(' and ');
    sendWithContext('Compare these sources: ' + names);
  }

  function exploreRelated() {
    var q = selectedSource ? selectedSource.title : currentTopic;
    setSearchQuery(q);
    doWorkspaceSearch(q);
  }

  function summarizeDiscussion() {
    sendWithContext(
      'Please summarize everything we have discussed and learned so far about "' +
      currentTopic +
      '". Consolidate the key findings, insights, and any conclusions across our entire conversation.'
    );
  }

  function refineSearch() {
    var convId = orchState.conversationId;
    if (!convId) return;
    setRefineLoading(true);
    var lastUserMsg = '';
    for (var i = orchState.messages.length - 1; i >= 0; i--) {
      if (orchState.messages[i].role === 'user') {
        lastUserMsg = orchState.messages[i].text;
        break;
      }
    }
    var question = lastUserMsg || currentTopic;
    refineQuery(question, convId).then(function (refined) {
      setRefineLoading(false);
      if (refined) {
        setSearchQuery(refined);
        setCurrentTopic(refined);
        doWorkspaceSearch(refined);
      }
    }).catch(function () {
      setRefineLoading(false);
    });
  }

  function resetWorkspace() {
    orchestrator.resetChat();
    setSearchResults([]); setTotalHits(0); setHasSearched(false);
    setSelectedSource(null); setPinnedSources([]);
    setCurrentTopic(''); setSearchQuery('');
    setConversationTopic('');
    currentPageRef.current = 1;
  }

  // ══════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════
  //
  // FIX Issue 2 — Layout strategy:
  //   ws-split is overflow:auto (single scroll container).
  //   ws-left uses position:sticky + top:0 + align-self:flex-start
  //     with max-height:100vh + overflow-y:auto for its own internal scroll.
  //   ws-right grows naturally with content.
  //   Result: left panel sticks in view as conversation grows on the right.

  return (
    <main className="px-page ws-page">
      {/* ── Header ── */}
      <header className="px-header ws-header">
        <a href="/" className="px-logo"><img src={logoUrl} alt="Logo" className="px-logo-img" /></a>
        <span className="ws-header-label">Discovery Workspace</span>
        {hasSearched && (
          <button className="px-dive-reset" onClick={resetWorkspace} style={{ marginLeft: 'auto' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
            New workspace
          </button>
        )}
      </header>

      {/* ── Landing (before first search) ── */}
      {!hasSearched && (
        <div className="ws-landing">
          <div className="ws-landing-inner">
            <h1 className="ws-landing-title">{labels.heroTitle || 'Start your research'}</h1>
            <p className="ws-landing-sub">{labels.heroSubtitle || 'Search to discover sources, then explore with AI assistance.'}</p>
            <form className="ws-landing-form" onSubmit={handleLandingSearch}>
              <input type="text" value={searchQuery} onChange={function (e) { setSearchQuery(e.target.value); }}
                placeholder={labels.searchPlaceholder || 'Search...'} className="ws-landing-input" autoFocus autoComplete="off" />
              <button type="submit" className="ws-search-btn" disabled={!searchQuery.trim()}>
                {labels.searchButtonText || 'Search'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Workspace (after search) ── */}
      {hasSearched && (
        <div className="ws-split">

          {/* ═══ LEFT: Search Results + Context (sticky) ═══ */}
          <div className="ws-left">
            {/* Search within workspace */}
            <div className="ws-left-search">
              <form onSubmit={handleWorkspaceSearch} className="ws-left-search-form">
                <input type="text" value={searchQuery} onChange={function (e) { setSearchQuery(e.target.value); }}
                  placeholder="Search..." className="ws-left-search-input" autoComplete="off" />
                <button type="submit" className="ws-left-search-btn" disabled={!searchQuery.trim()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                </button>
              </form>

              {/* Dive deeper button — visible when search topic has no matching conversation */}
              {currentTopic !== conversationTopic && !searchLoading && searchResults.length > 0 && (
                <button className="ws-dive-btn" onClick={diveDeeper}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Dive deeper into &ldquo;{currentTopic.length > 30 ? currentTopic.substring(0, 30) + '...' : currentTopic}&rdquo;
                </button>
              )}
            </div>

            {/* Current context panel */}
            <div className="ws-context-panel">
              <div className="ws-context-row">
                <span className="ws-context-label">Topic</span>
                <span className="ws-context-value">{currentTopic}</span>
              </div>
              {selectedSource && (
                <div className="ws-context-row">
                  <span className="ws-context-label">Selected</span>
                  <span className="ws-context-value ws-context-highlight">{selectedSource.title}</span>
                </div>
              )}
              {pinnedSources.length > 0 && (
                <div className="ws-context-row">
                  <span className="ws-context-label">Pinned</span>
                  <span className="ws-context-value">{pinnedSources.length} source{pinnedSources.length !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>

            {/* Pinned sources */}
            {pinnedSources.length > 0 && (
              <div className="ws-pinned-section">
                <h3 className="ws-section-label">★ Pinned Sources</h3>
                {pinnedSources.map(function (s, i) {
                  var sel = selectedSource && selectedSource.url === s.url;
                  return (
                    <div key={'pin-' + i} className={'ws-result-row' + (sel ? ' ws-row-selected' : '')} onClick={function () { selectSource(s); }}>
                      <div className="ws-result-row-text">
                        <span className="ws-result-row-title">{s.title}</span>
                      </div>
                      <div className="ws-result-row-actions">
                        <button className="ws-icon-btn ws-icon-ask" onClick={function (e) { e.stopPropagation(); askAboutSource(s); }} title="Ask AI about this">💬</button>
                        {s.url && (
                          <button className="ws-icon-btn ws-icon-open" onClick={function (e) { e.stopPropagation(); window.open(s.url, '_blank', 'noopener,noreferrer'); }} title="Open link">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </button>
                        )}
                        <button className="ws-icon-btn ws-icon-unpin" onClick={function (e) { e.stopPropagation(); unpinSource(s); }} title="Unpin">×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Search results */}
            <div className="ws-results-panel">
              <h3 className="ws-section-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                Search Results
                {totalHits > 0 && (
                  <span className="ws-count-badge">
                    {searchResults.length < totalHits
                      ? ('Showing ' + searchResults.length + ' of ' + totalHits)
                      : totalHits
                    }
                  </span>
                )}
              </h3>

              {searchLoading && <LoadingDots message="Searching..." />}

              {!searchLoading && searchResults.map(function (r, i) {
                var pinned = isPinned(r);
                var sel = selectedSource && selectedSource.url === r.url;
                return (
                  <div key={i} className={'ws-result-row' + (sel ? ' ws-row-selected' : '')} onClick={function () { selectSource(r); }}>
                    {r.thumbnail && <img src={r.thumbnail} alt="" className="ws-result-row-thumb" onError={function (e) { e.target.style.display = 'none'; }} />}
                    <div className="ws-result-row-text">
                      <span className="ws-result-row-title">{r.title}</span>
                      {r.snippet && <span className="ws-result-row-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />}
                    </div>
                    <div className="ws-result-row-actions">
                      <button className="ws-icon-btn ws-icon-ask" onClick={function (e) { e.stopPropagation(); askAboutSource(r); }} title="Ask AI about this">💬</button>
                      {r.url && (
                        <button className="ws-icon-btn ws-icon-open" onClick={function (e) { e.stopPropagation(); window.open(r.url, '_blank', 'noopener,noreferrer'); }} title="Open link">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </button>
                      )}
                      <button className={'ws-icon-btn' + (pinned ? ' ws-icon-pinned' : '')}
                        onClick={function (e) { e.stopPropagation(); pinned ? unpinSource(r) : pinSource(r); }}
                        title={pinned ? 'Unpin' : 'Pin'}>
                        {pinned ? '★' : '☆'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Load more — uses client.nextPage() then search() */}
              {!searchLoading && searchResults.length > 0 && searchResults.length < totalHits && (
                <button className="ws-load-more-btn" onClick={loadMoreResults} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : 'Load more results'}
                </button>
              )}

              {!searchLoading && searchResults.length === 0 && (
                <p className="ws-no-results">No results found.</p>
              )}
            </div>
          </div>

          {/* ═══ RIGHT: AI Conversation ═══ */}
          <div className="ws-right">
            {/* Conversation header */}
            <div className="ws-convo-header">
              <div className="ws-convo-header-top">
                <h3 className="ws-section-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  AI Conversations
                </h3>
                {(selectedSource || pinnedSources.length > 0) && (
                  <span className="ws-using-badge">
                    Using {selectedSource ? '1 selected' : ''}{selectedSource && pinnedSources.length > 0 ? ' + ' : ''}{pinnedSources.length > 0 ? pinnedSources.length + ' pinned' : ''} source{(pinnedSources.length + (selectedSource ? 1 : 0)) !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Conversation — no separate scroll container, grows naturally */}
            <div className="ws-convo-body">
              {hasConversation ? (
                <ConversationThread
                  messages={orchState.messages}
                  isLoading={orchState.followUpLoading}
                  isStreaming={orchState.followUpStreaming}
                  streamingText={orchState.streamingText}
                  streamingLabel={'Thinking...'}
                  sourcesLabel={'Sources'}
                />
              ) : (
                <div className="ws-ai-empty">
                  <p>Search results are ready. Click <strong>Dive deeper</strong> on the left to start an AI conversation, or select a result and ask AI to explore it.</p>
                </div>
              )}
            </div>

            {/* Next actions — sticky at bottom of right panel */}
            <div className="ws-right-footer">
              {!orchState.followUpLoading && !orchState.followUpStreaming && (
                <div className="ws-next-actions ws-next-actions-emphasis">
                  <span className="ws-next-label">Next steps</span>
                  <div className="ws-next-btns">
                    {hasConversation && (
                      <button className="ws-next-btn ws-next-btn-primary" onClick={diveDeeper}>
                        New conversation
                      </button>
                    )}
                    {selectedSource && (
                      <button className="ws-next-btn" onClick={function () { askAboutSource(selectedSource); }}>
                        Explore &ldquo;{selectedSource.title.substring(0, 25)}{selectedSource.title.length > 25 ? '...' : ''}&rdquo;
                      </button>
                    )}
                    {pinnedSources.length >= 2 && (
                      <button className="ws-next-btn" onClick={comparePinned}>Compare pinned sources</button>
                    )}
                    {hasConversation && orchState.conversationId && (
                      <button className="ws-next-btn" onClick={refineSearch} disabled={refineLoading}>
                        {refineLoading ? 'Refining...' : 'Refine search'}
                      </button>
                    )}
                    {hasConversation && (
                      <button className="ws-next-btn" onClick={summarizeDiscussion}>Summarize findings</button>
                    )}
                    <button className="ws-next-btn" onClick={exploreRelated}>
                      Find related results
                    </button>
                  </div>
                </div>
              )}

              {/* Input */}
              <div className="ws-convo-input ws-convo-input-emphasis">
                <FollowUpInput
                  onSubmit={sendWithContext}
                  isDisabled={orchState.followUpLoading || orchState.followUpStreaming}
                  hasConversation={orchState.conversationStarted}
                  followUpPlaceholder={selectedSource ? ('Ask about "' + selectedSource.title.substring(0, 30) + '..."') : (labels.followUpPlaceholder || 'Ask about your sources...')}
                  freshPlaceholder={labels.searchPlaceholder || 'Ask a question...'}
                  maxLength={config.maxFollowUpLength}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="px-footer" style={{ borderTop: '1px solid var(--border)' }}>
        <p><a href={labels.footerBrandUrl} target="_blank" rel="noopener noreferrer">Powered by AddSearch</a></p>
      </footer>
    </main>
  );
}
