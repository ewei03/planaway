"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client";

/** What to include for each topic, shown under the topic picker. */
const HINTS: Record<string, string> = {
  "Something isn't working": "Tell us what you did, what you expected, and what happened instead.",
  "Account help": "Write from the email address on your account, if you can. Forgot your password? You can reset it from the sign-in page.",
  "Ideas and feedback": "What would make PlanAway better for your next trip?",
  "Privacy questions": "Questions about your data, or a request to see, correct, or delete it.",
  "Something else": "",
};

/** Sends a message to the PlanAway team; replies come by email. Prefilled for signed-in people. */
export function ContactForm({ topics, initial }: { topics: string[]; initial: { name: string; email: string } }) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [topic, setTopic] = useState(topics[0]);
  const [message, setMessage] = useState("");
  // Hidden from people; bots fill it in.
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/contact", { method: "POST", body: JSON.stringify({ name, email, topic, message, website }) });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <div className="card contact-form" role="status">
        <h2>Thanks, your message is on its way</h2>
        <p className="muted">
          We&rsquo;ll reply to <b>{email}</b>, usually within a couple of working days.
        </p>
        <button
          className="btn"
          onClick={() => {
            setSent(false);
            setMessage("");
          }}
        >
          Send another message
        </button>
      </div>
    );

  return (
    <form className="card contact-form" onSubmit={submit}>
      <h2>Send us a message</h2>
      <div className="grid">
        <div>
          <label htmlFor="contact-name">Name</label>
          <input id="contact-name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="contact-email">Email</label>
          <input id="contact-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <label htmlFor="contact-topic">Topic</label>
      <select id="contact-topic" value={topic} onChange={(e) => setTopic(e.target.value)} aria-describedby="contact-topic-hint">
        {topics.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      {HINTS[topic] && (
        <p id="contact-topic-hint" className="muted small contact-hint">
          {HINTS[topic]}
        </p>
      )}
      <label htmlFor="contact-message">Message</label>
      <textarea id="contact-message" required minLength={10} maxLength={5000} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="contact-trap" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}
