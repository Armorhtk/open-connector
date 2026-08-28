import type { TikHubLlmsIndexEntry } from "./endpoint-types.ts";

export const tikhubDocsIndexUrl = "https://docs.tikhub.io/llms.txt";

const tikhubDocsOrigin = "https://docs.tikhub.io";

export function parseTikHubLlmsIndex(content: string): TikHubLlmsIndexEntry[] {
  const entries: TikHubLlmsIndexEntry[] = [];
  let inApiDocs = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "## API Docs") {
      inApiDocs = true;
      continue;
    }
    if (inApiDocs && trimmed.startsWith("## ")) {
      break;
    }
    if (!inApiDocs || !trimmed.startsWith("- ")) {
      continue;
    }

    const entry = parseTikHubIndexEntry(trimmed);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseTikHubIndexEntry(line: string): TikHubLlmsIndexEntry | undefined {
  const categoryEnd = line.indexOf(" [", 2);
  if (categoryEnd < 0) {
    return undefined;
  }
  const linkStart = categoryEnd + 1;
  const titleEnd = line.indexOf("](", linkStart);
  const urlEnd = titleEnd < 0 ? -1 : line.indexOf(")", titleEnd + 2);
  if (titleEnd < 0 || urlEnd < 0) {
    return undefined;
  }

  const category = line.slice(2, categoryEnd).trim();
  const title = line.slice(linkStart + 1, titleEnd).trim();
  const documentationUrl = line.slice(titleEnd + 2, urlEnd).trim();
  const endpointId = validateDocumentationUrl(documentationUrl);
  if (!endpointId || category === "" || title === "") {
    return undefined;
  }

  const descriptionStart = line.indexOf(":", urlEnd + 1);
  return {
    endpointId,
    category,
    title,
    description: descriptionStart < 0 ? "" : line.slice(descriptionStart + 1).trim(),
    documentationUrl,
  };
}

function validateDocumentationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.origin !== tikhubDocsOrigin ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith("/") ||
    !url.pathname.endsWith(".md")
  ) {
    return undefined;
  }
  const endpointId = url.pathname.slice(1, -3);
  if (!endpointId.endsWith("e0") || !containsOnlyDigits(endpointId.slice(0, -2))) {
    return undefined;
  }
  return endpointId;
}

function containsOnlyDigits(value: string) {
  if (value === "") {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}
