/**
 * components/SmoothStreamingText.js
 *
 * Makes streaming feel smoother by revealing the latest accumulated text
 * over animation frames. This avoids reparsing markdown on every token.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

export default function SmoothStreamingText({ content, isStreaming, className }) {
  var targetRef = useRef(content || '');
  var rafRef = useRef(null);
  var [displayed, setDisplayed] = useState(content || '');

  useEffect(function () {
    targetRef.current = content || '';

    if (!isStreaming) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setDisplayed(targetRef.current);
      return;
    }

    function tick() {
      setDisplayed(function (prev) {
        var target = targetRef.current;
        if (prev.length >= target.length) {
          return prev;
        }

        var remaining = target.length - prev.length;
        var step = remaining > 120 ? 12 : remaining > 60 ? 8 : remaining > 24 ? 5 : 3;
        return target.slice(0, prev.length + step);
      });

      rafRef.current = requestAnimationFrame(function () {
        if (targetRef.current.length > 0) {
          tick();
        }
      });
    }

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return function () {
      if (rafRef.current && !isStreaming) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [content, isStreaming]);

  useEffect(function () {
    return function () {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  if (!displayed) return null;

  return (
    <div className={'md-content px-streaming-text' + (className ? ' ' + className : '')}>
      {displayed}
    </div>
  );
}
