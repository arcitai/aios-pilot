const BLOCKED_CONTENT_TAGS =
  /<(script|iframe|frame|frameset|object|embed|form|svg|math|video|audio|source|picture|portal|meta|base|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCKED_SINGLE_TAGS =
  /<\/?(?:script|iframe|frame|frameset|object|embed|form|input|select|option|textarea|svg|math|video|audio|source|picture|portal|meta|base|link)\b[^>]*>/gi;
const UNSAFE_ATTRIBUTES =
  /\s+(?:on[a-z0-9_:-]*|srcdoc|href|xlink:href|src|srcset|action|formaction|poster|background|cite)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const INLINE_STYLE_ATTRIBUTE = /\s+style\s*=\s*("([^"]*)"|'([^']*)')/gi;

function removeActiveCss(css: string): string {
  return css
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "none")
    .replace(/-moz-binding\s*:[^;}]*/gi, "");
}

function sanitizePreviewMarkup(markup: string): string {
  return markup
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(BLOCKED_CONTENT_TAGS, "")
    .replace(BLOCKED_SINGLE_TAGS, "")
    .replace(UNSAFE_ATTRIBUTES, "")
    .replace(
      INLINE_STYLE_ATTRIBUTE,
      (_match, _quoted, doubleQuoted, singleQuoted) => {
        const style = removeActiveCss(doubleQuoted ?? singleQuoted ?? "");
        return ` style="${style.replaceAll('"', "&quot;")}"`;
      },
    )
    .replace(
      /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
      (_match, attrs, css) => {
        return `<style${attrs}>${removeActiveCss(css)}</style>`;
      },
    );
}

/**
 * Return a self-contained document for an opaque-origin, sandboxed iframe.
 * The input is also stripped of executable elements, URL-bearing attributes,
 * external CSS loads, forms, and navigation links before it reaches srcDoc.
 */
export function createSandboxedPreviewDocument(html: string): string {
  const sanitized = sanitizePreviewMarkup(html);
  const policy =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'";
  const policyMeta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  // Install the policy before any supplied markup, including malformed full
  // documents with style/images before their own head. Regex cleanup improves
  // the preview; the opaque sandbox and CSP enforce the execution boundary.
  return `<!doctype html><html><head>${policyMeta}</head><body>${sanitized}</body></html>`;
}

export function createSlidesExportHtml(
  title: string,
  slides: Array<{ title: string; body: string }>,
): string {
  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const pages = slides
    .map(
      (slide, index) =>
        `<section><span>${String(index + 1).padStart(2, "0")}</span><h1>${escapeHtml(slide.title)}</h1><p>${escapeHtml(slide.body).replaceAll("\n", "<br>")}</p></section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#eceeea;color:#20231e;font:1rem/1.5 Inter,system-ui,sans-serif}section{position:relative;display:flex;flex-direction:column;justify-content:center;width:min(100% - 48px,1100px);min-height:min(62vw,640px);margin:32px auto;padding:8%;border:1px solid #d7dad3;border-radius:18px;background:#fafbf8;box-shadow:0 10px 40px #20231e12}span{color:#73796d;font-size:0.75rem;font-weight:700;letter-spacing:.16em}h1{max-width:840px;margin:28px 0 16px;font-size:clamp(2.5rem,7vw,5.5rem);line-height:1.02;letter-spacing:-.055em}p{max-width:720px;color:#565c52;font-size:clamp(1.125rem,2.4vw,1.6875rem);white-space:normal}@media print{body{background:white}section{width:100%;min-height:100vh;margin:0;border:0;border-radius:0;box-shadow:none;break-after:page}}
</style></head><body>${pages}</body></html>`;
}

export function createCalendarIcs(
  events: Array<{
    id: string;
    title: string;
    description: string;
    startsAt: string;
    endsAt: string;
  }>,
): string {
  const escapeText = (value: string) =>
    value
      .replaceAll("\\", "\\\\")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,")
      .replaceAll(/\r\n?|\n/g, "\\n");
  const toUtc = (value: string) =>
    new Date(value)
      .toISOString()
      .replaceAll(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const items = [...events]
    .sort(
      (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
    )
    .map(
      (event) =>
        `BEGIN:VEVENT\r\nUID:${escapeText(event.id)}@buzz-local\r\nDTSTAMP:${toUtc(new Date().toISOString())}\r\nDTSTART:${toUtc(event.startsAt)}\r\nDTEND:${toUtc(event.endsAt)}\r\nSUMMARY:${escapeText(event.title)}\r\nDESCRIPTION:${escapeText(event.description)}\r\nEND:VEVENT`,
    );
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Buzz//AIOS Calendar//EN\r\n${items.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
