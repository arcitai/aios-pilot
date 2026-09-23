import type { SiteDocument } from "./document";

function escapeTitle(title: string) {
  return title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRawTextEndTag(content: string, tagName: "script" | "style") {
  return content.replaceAll(new RegExp(`</${tagName}`, "gi"), `<\\/${tagName}`);
}

/** Produce one offline HTML file with the three fixed site files inlined. */
export function buildStandaloneHtml(document: SiteDocument) {
  const style = escapeRawTextEndTag(document.files.styleCss, "style");
  const script = escapeRawTextEndTag(document.files.appJs, "script");
  const standaloneCsp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${standaloneCsp}">
  <title>${escapeTitle(document.title)}</title>
  <style>${style}</style>
</head>
<body>
${document.files.indexHtml}
<script>${script}</script>
</body>
</html>
`;
}
