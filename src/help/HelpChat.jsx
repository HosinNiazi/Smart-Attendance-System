import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../components/shared.jsx";
import { getAnswer, STARTER_MESSAGE } from "./helpAssistant.js";

const starterSuggestions = getAnswer("").suggestions;

function createWelcomeMessage() {
  return {
    id: "welcome",
    role: "bot",
    text: STARTER_MESSAGE,
    suggestions: starterSuggestions,
  };
}

export function HelpChat({ open, onClose }) {
  const [messages, setMessages] = useState([createWelcomeMessage()]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const counter = useRef(0);
  const timerRef = useRef(null);
  const typingGuard = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 140);
    return () => clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages, typing, open]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function ask(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value || typingGuard.current) return;

    typingGuard.current = true;
    setText("");
    counter.current += 1;
    const userMessage = {
      id: `user-${counter.current}`,
      role: "user",
      text: value,
    };
    setMessages((current) => [...current, userMessage]);
    setTyping(true);

    const delay = Math.min(340 + value.length * 14, 900);
    timerRef.current = setTimeout(() => {
      const result = getAnswer(value);
      counter.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: `bot-${counter.current}`,
          role: "bot",
          text: result.answer,
          suggestions: result.suggestions,
        },
      ]);
      setTyping(false);
      typingGuard.current = false;
    }, delay);
  }

  function resetChat() {
    if (timerRef.current) clearTimeout(timerRef.current);
    typingGuard.current = false;
    setTyping(false);
    setText("");
    setMessages([createWelcomeMessage()]);
  }

  if (!open) return null;

  const lastBotIndex = messages.reduce(
    (last, message, index) => (message.role === "bot" ? index : last),
    -1,
  );

  return (
    <section
      className="help-chat"
      role="dialog"
      aria-label="دستیار راهنمای حضوربان"
      aria-live="polite"
    >
      <header className="help-chat-head">
        <span className="help-chat-avatar" aria-hidden="true">
          <Icon name="bi-stars" />
        </span>
        <div className="help-chat-title">
          <strong>دستیار حضوربان</strong>
          <small>پاسخ فوری بر اساس راهنمای سامانه</small>
        </div>
        <button
          className="help-chat-icon"
          type="button"
          title="گفت‌وگوی جدید"
          aria-label="گفت‌وگوی جدید"
          onClick={resetChat}
        >
          <Icon name="bi-arrow-counterclockwise" />
        </button>
        <button
          className="help-chat-icon"
          type="button"
          title="بستن راهنما"
          aria-label="بستن راهنما"
          onClick={onClose}
        >
          <Icon name="bi-x-lg" />
        </button>
      </header>

      <div className="help-chat-body" ref={bodyRef}>
        {messages.map((message, index) => (
          <div
            className={`help-msg-row help-msg-${message.role}`}
            key={message.id}
          >
            {message.role === "bot" && (
              <span className="help-msg-avatar" aria-hidden="true">
                <Icon name="bi-stars" />
              </span>
            )}
            <div className="help-msg">
              <p>{message.text}</p>
              {message.role === "bot" &&
                index === lastBotIndex &&
                message.suggestions?.length > 0 && (
                  <div className="help-suggestions">
                    <span>موضوع‌های پیشنهادی</span>
                    <div className="help-suggestion-list">
                      {message.suggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => ask(suggestion.title)}
                        >
                          <Icon name={suggestion.icon} />
                          {suggestion.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>
        ))}

        {typing && (
          <div className="help-msg-row help-msg-bot">
            <span className="help-msg-avatar" aria-hidden="true">
              <Icon name="bi-stars" />
            </span>
            <div className="help-msg help-typing" aria-label="در حال نوشتن پاسخ">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <form
        className="help-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          ask(text);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="form-control"
          value={text}
          maxLength={300}
          placeholder="سؤال خود را بنویسید…"
          aria-label="متن سؤال"
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          className="help-chat-send"
          aria-label="ارسال سؤال"
          title="ارسال"
          disabled={!text.trim() || typing}
        >
          <Icon name="bi-send-fill" />
        </button>
      </form>
    </section>
  );
}
