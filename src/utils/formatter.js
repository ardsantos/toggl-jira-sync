import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(duration);
dayjs.extend(utc);

function removeJiraIssueKey(description) {
  if (!description) return description;
  return description.replace(/\b[A-Z][A-Z0-9]+-\d+:?\s*/g, "").trim();
}

export function formatDuration(seconds) {
  const dur = dayjs.duration(seconds, "seconds");
  const hours = Math.floor(dur.asHours());
  const minutes = dur.minutes();

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatJiraWorkLog(issueKey, entries) {
  const totalSeconds = entries.reduce(
    (sum, entry) => sum + entry.durationSeconds,
    0
  );
  const descriptions = [
    ...new Set(entries.map((e) => removeJiraIssueKey(e.description))),
  ].filter((d) => d);

  return {
    issueKey,
    timeSpentSeconds: totalSeconds,
    timeSpentFormatted: formatDuration(totalSeconds),
    startedAt: entries[0].startedAt,
    comment: descriptions.join("; "),
    entryCount: entries.length,
    entries: entries, // Add entries to access tags
  };
}

export function formatJiraWorkLogWithBreakdown(issueKey, entries, date) {
  const totalSeconds = entries.reduce(
    (sum, entry) => sum + entry.durationSeconds,
    0
  );

  // Create detailed breakdown of time entries
  const timeBreakdown = entries.map((entry) => {
    const startTime = dayjs.utc(entry.startedAt).format("HH:mm");
    const endTime = dayjs
      .utc(entry.startedAt)
      .add(entry.durationSeconds, "seconds")
      .format("HH:mm");
    const duration = formatDuration(entry.durationSeconds);

    return {
      timeRange: `${startTime}-${endTime}`,
      duration: duration,
      description: entry.description || "(No description)",
    };
  });

  // Create a comment with detailed breakdown
  const comment = formatDetailedComment(
    timeBreakdown,
    totalSeconds,
    entries.length
  );

  return {
    issueKey,
    date,
    timeSpentSeconds: totalSeconds,
    timeSpentFormatted: formatDuration(totalSeconds),
    startedAt: entries[0].startedAt,
    comment: comment,
    entryCount: entries.length,
    timeBreakdown: timeBreakdown,
    entries: entries, // Add entries to access tags
  };
}

function formatDetailedComment(timeBreakdown, totalSeconds, entryCount) {
  let comment = "";
  const entriesDescriptions = new Set(
    timeBreakdown
      .map((entry) => removeJiraIssueKey(entry.description))
      .filter((d) => d)
  );

  entriesDescriptions.forEach((description) => {
    comment += `• ${description}\n`;
  });

  return comment;
}

export function formatTimetrackerWorklog(parsedEntry, worklogTagIds = [], issueId = null) {
  const cleanDescription = removeJiraIssueKey(parsedEntry.description);

  return {
    description: cleanDescription ? `• ${cleanDescription}` : parsedEntry.description,
    durationInSeconds: parsedEntry.durationSeconds,
    isBillable: true,
    issueId: issueId,
    workDate: dayjs(parsedEntry.startedAt).format("YYYY-MM-DD"),
    workStartTime: dayjs(parsedEntry.startedAt).format("HH:mm"),
    worklogTagIds: worklogTagIds.length > 0 ? worklogTagIds : undefined,
  };
}

export function prepareSummaryData(
  jiraEntries,
  nonJiraEntries,
  entriesWithoutTags = [],
  alreadySyncedEntries = {}
) {
  const jiraSummary = Object.entries(jiraEntries).map(([key, group]) => {
    const timeBreakdown = group.entries.map((entry) => {
      const startTime = dayjs.utc(entry.startedAt).format("HH:mm");
      const endTime = dayjs
        .utc(entry.startedAt)
        .add(entry.durationSeconds, "seconds")
        .format("HH:mm");
      const duration = formatDuration(entry.durationSeconds);

      return {
        timeRange: `${startTime}-${endTime}`,
        duration: duration,
        description: entry.description || "(No description)",
      };
    });

    return {
      issueKey: group.issueKey,
      date: group.date,
      timeSpentSeconds: group.totalSeconds,
      timeSpentFormatted: formatDuration(group.totalSeconds),
      startedAt: group.entries[0].startedAt,
      entryCount: group.entries.length,
      entries: group.entries,
      timeBreakdown: timeBreakdown,
    };
  });

  const nonJiraSummary = nonJiraEntries.map((group) => ({
    description: group.description,
    totalTime: formatDuration(group.totalSeconds),
    entryCount: group.entries.length,
  }));

  const entriesWithoutTagsSummary = entriesWithoutTags.map((group) => ({
    description: group.description,
    totalTime: formatDuration(group.totalSeconds),
    entryCount: group.entries.length,
  }));

  const alreadySyncedSummary = Object.entries(alreadySyncedEntries).map(
    ([issueKey, group]) => ({
      issueKey,
      timeFormatted: formatDuration(group.totalSeconds),
      description: [
        ...new Set(group.entries.map((e) => removeJiraIssueKey(e.description))),
      ]
        .filter((d) => d)
        .join("; "),
      entryCount: group.entries.length,
    })
  );

  const totalJiraTime = jiraSummary.reduce(
    (sum, item) => sum + item.timeSpentSeconds,
    0
  );
  const totalNonJiraTime = nonJiraEntries.reduce(
    (sum, group) => sum + group.totalSeconds,
    0
  );
  const totalAlreadySyncedTime = Object.values(alreadySyncedEntries).reduce(
    (sum, group) => sum + group.totalSeconds,
    0
  );

  const totalEntriesWithoutTagsTime = entriesWithoutTags.reduce(
    (sum, group) => sum + group.totalSeconds,
    0
  );

  return {
    jiraWorkLogs: jiraSummary,
    nonJiraEntries: nonJiraSummary,
    entriesWithoutTags: entriesWithoutTagsSummary,
    alreadySynced: alreadySyncedSummary,
    totals: {
      jiraTime: formatDuration(totalJiraTime),
      jiraTimeSeconds: totalJiraTime,
      nonJiraTime: formatDuration(totalNonJiraTime),
      nonJiraTimeSeconds: totalNonJiraTime,
      entriesWithoutTagsTime: formatDuration(totalEntriesWithoutTagsTime),
      entriesWithoutTagsTimeSeconds: totalEntriesWithoutTagsTime,
      alreadySyncedTime:
        totalAlreadySyncedTime > 0
          ? formatDuration(totalAlreadySyncedTime)
          : null,
      alreadySyncedTimeSeconds: totalAlreadySyncedTime,
      totalTime: formatDuration(
        totalJiraTime +
          totalNonJiraTime +
          totalAlreadySyncedTime +
          totalEntriesWithoutTagsTime
      ),
      totalTimeSeconds:
        totalJiraTime +
        totalNonJiraTime +
        totalAlreadySyncedTime +
        totalEntriesWithoutTagsTime,
    },
  };
}
