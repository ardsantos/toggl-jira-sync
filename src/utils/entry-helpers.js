export function findGroupByWorkLog(groupedEntries, workLog) {
  return Object.keys(groupedEntries).find((key) => {
    const group = groupedEntries[key];
    return (
      group.issueKey === workLog.issueKey &&
      group.entries.some((e) => e.startedAt === workLog.startedAt)
    );
  });
}

export function groupEntriesByDate(entries, issueKey) {
  const grouped = {};

  entries.forEach((entry) => {
    const date = entry.startedAt.split('T')[0];
    const groupKey = issueKey ? `${issueKey}_${date}` : `${entry.issueKey}_${date}`;

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        issueKey: issueKey || entry.issueKey,
        date: date,
        entries: [],
        totalSeconds: 0,
      };
    }

    grouped[groupKey].entries.push(entry);
    grouped[groupKey].totalSeconds += entry.durationSeconds;
  });

  Object.values(grouped).forEach((group) => {
    group.entries.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  });

  return grouped;
}
