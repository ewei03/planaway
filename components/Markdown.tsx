import { Fragment, type ReactNode } from "react";

// Minimal Markdown for chat replies: paragraphs, bullet lists, **bold**,
// *italic*, and [links](https://...). Builds React elements, never HTML strings.

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[1] !== undefined) {
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>,
      );
    } else if (m[3] !== undefined) {
      out.push(<strong key={key}>{m[3]}</strong>);
    } else {
      out.push(<em key={key}>{m[4]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*([-*]|\d+\.)\s+/;

export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => BULLET.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(BULLET, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
