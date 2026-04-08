/**
 * components/AiAnswerCard.js
 * Dumb component. All labels from props. Never imports config.
 */
'use client';

import MarkdownRenderer from './MarkdownRenderer';

export default function AiAnswerCard({
  answer, sources, isStreaming,
  label, query, streamingLabel, sourcesLabel, diveButtonText,
  showDiveCta, onDiveDeeper,
}) {
  var sourcesText = (sourcesLabel || '{count} sources').replace('{count}', (sources || []).length);

  return (
    <div className={'px-answer-card' + (query ? ' px-initial-answer' : '')}>
      <div className="px-answer-label">
        {label || 'AI Answer'}
        {query && <> for: <strong>{query}</strong></>}
        {isStreaming && <span className="px-streaming-badge">{streamingLabel || 'Streaming...'}</span>}
      </div>
      <MarkdownRenderer content={answer} />
      {!isStreaming && sources && sources.length > 0 && (
        <div className="px-sources">
          <p className="px-sources-label">{sourcesText}</p>
          <div className="px-sources-row">
            {sources.map(function (s, i) {
              return <a key={i} className="px-source" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>;
            })}
          </div>
        </div>
      )}
      {showDiveCta && !isStreaming && (
        <button className="px-dive-cta" onClick={onDiveDeeper}>{diveButtonText || 'Dive Deeper →'}</button>
      )}
    </div>
  );
}
