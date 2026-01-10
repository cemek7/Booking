import React, { useState, useRef } from "react";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeout = useRef<NodeJS.Timeout | null>(null);

  function show() {
    timeout.current = setTimeout(() => setVisible(true), 200);
  }
  function hide() {
    if (timeout.current) clearTimeout(timeout.current);
    setVisible(false);
  }

  return (
    <span
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      {children}
      {visible && (
        <span className="absolute z-50 left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-gray-900/90 backdrop-blur-sm text-white text-xs rounded shadow-lg whitespace-pre-line min-w-max max-w-xs">
          {content}
        </span>
      )}
    </span>
  );
}
