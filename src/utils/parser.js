import { groupEntriesByDate } from './entry-helpers.js';

export function extractJiraIssueKey(description) {
  if (!description) return null;

  const jiraKeyPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/;
  const match = description.match(jiraKeyPattern);

  return match ? match[1] : null;
}

export function parseTimeEntry(entry) {
  const issueKey = extractJiraIssueKey(entry.description);
  const hasTags =
    !!(entry.tags && Array.isArray(entry.tags) && entry.tags.length > 0);

  return {
    id: entry.id,
    description: entry.description,
    durationSeconds: entry.duration > 0 ? entry.duration : 0,
    startedAt: entry.start,
    issueKey,
    hasJiraIssue: !!issueKey,
    hasTags: hasTags,
    tags: entry.tags || [],
  };
}

export function groupEntriesByDescription(entries) {
  const grouped = {};

  entries.forEach((entry) => {
    const key = entry.description || "(No description)";

    if (!grouped[key]) {
      grouped[key] = {
        description: key,
        entries: [],
        totalSeconds: 0,
      };
    }

    grouped[key].entries.push(entry);
    grouped[key].totalSeconds += entry.durationSeconds;
  });

  return Object.values(grouped);
}

export function groupEntriesByIssueKey(entries) {
  const grouped = {};

  entries.forEach((entry) => {
    if (!entry.issueKey) return;

    if (!grouped[entry.issueKey]) {
      grouped[entry.issueKey] = {
        issueKey: entry.issueKey,
        entries: [],
        totalSeconds: 0,
      };
    }

    grouped[entry.issueKey].entries.push(entry);
    grouped[entry.issueKey].totalSeconds += entry.durationSeconds;
  });

  return grouped;
}

export function groupEntriesByIssueKeyAndDate(entries) {
  const validEntries = entries.filter(entry => entry.issueKey);
  return groupEntriesByDate(validEntries);
}
