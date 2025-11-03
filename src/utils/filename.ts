/**
 * Normalizes a filename by removing emoticons, brackets content, and hashtags.
 * Preserves spaces and alphanumeric characters.
 * @param fileName - The original filename to normalize
 * @returns A normalized filename suitable for display
 */
export function normalizeFileName(fileName: string): string {
  let normalized = fileName;

  // Remove content inside brackets (including the brackets themselves)
  // Matches [], {}, ()
  normalized = normalized.replace(/[[\]{}()][^[\]{}()]*[[\]{}()]/g, '');
  normalized = normalized.replace(/[[\]{}()]/g, '');

  // Remove content with hashtags
  normalized = normalized.replace(/#\S+/g, '');

  // Remove emoji and other unicode symbols
  // This regex removes most emojis and special unicode characters
  normalized = normalized.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
  normalized = normalized.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols and Pictographs
  normalized = normalized.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map
  normalized = normalized.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Flags
  normalized = normalized.replace(/[\u{2600}-\u{26FF}]/gu, ''); // Misc symbols
  normalized = normalized.replace(/[\u{2700}-\u{27BF}]/gu, ''); // Dingbats
  normalized = normalized.replace(/[\u{1F900}-\u{1F9FF}]/gu, ''); // Supplemental Symbols and Pictographs
  normalized = normalized.replace(/[\u{1FA00}-\u{1FA6F}]/gu, ''); // Chess Symbols
  normalized = normalized.replace(/[\u{1FA70}-\u{1FAFF}]/gu, ''); // Symbols and Pictographs Extended-A
  normalized = normalized.replace(/[\u{FE00}-\u{FE0F}]/gu, ''); // Variation Selectors
  normalized = normalized.replace(/[\u{200D}]/gu, ''); // Zero Width Joiner

  // Remove any remaining special characters except alphanumeric, spaces, - and _
  normalized = normalized.replace(/[^a-zA-Z0-9 _-]/g, '');

  // Normalize multiple spaces to single space
  normalized = normalized.replace(/\s+/g, ' ');

  // Trim whitespace
  normalized = normalized.trim();

  return normalized;
}

/**
 * Validates and sanitizes a filename for safe file system usage.
 * Converts to lowercase and replaces special characters with underscores.
 * @param fileName - The filename to validate
 * @returns A sanitized filename safe for file system operations
 */
export function validateFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}
