/**
 * components/ConversationThread.js
 * Dumb component. Never imports config. Labels from props.
 */
'use client';

import { useEffect, useRef } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import LoadingDots from './LoadingDots';

export default function ConversationThread({ messages, isLoading, isStreaming, streamingText, streamingLabel }) {
  var lastQuestionRef = useRef(null);

  var lastUserIdx = -1;
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break; }
  }

  useEffect(function () {
    if (lastQuestionRef.current) {
      setTimeout(function () {
        if (lastQuestionRef.current) lastQuestionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [messages, isLoading, isStreaming]);

  return (
    <>
      {messages.map(function (msg, i) {
        return (
          <div key={i} ref={i === lastUserIdx ? lastQuestionRef : null} className={'px-msg px-msg-' + msg.role}>
            {msg.role === 'user' ? (
              <div className="px-user-bubble">{msg.text}</div>
            ) : (
              <div className="px-answer-card">
                <MarkdownRenderer content={msg.text} />
                {msg.sources && msg.sources.length > 0 && (
                  <div className="px-sources"><div className="px-sources-row">
                    {msg.sources.map(function (s, j) {
                      return <a key={j} className="px-source" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>;
                    })}
                  </div></div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {isStreaming && streamingText && (
        <div className="px-answer-card">
          <div className="px-answer-label">
            <span className="px-streaming-badge">{streamingLabel || 'Streaming...'}</span>
          </div>
          <MarkdownRenderer content={streamingText} />
        </div>
      )}

      {isLoading && !isStreaming && (
        <div style={{ padding: '20px 0' }}><LoadingDots /></div>
      )}
    </>
  );
}
