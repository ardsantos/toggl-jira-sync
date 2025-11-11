import axios from "axios";
import { config } from "../config.js";
import { JiraClient } from "./jira.js";
import { formatTimetrackerWorklog } from "../utils/formatter.js";

export class TimetrackerClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.timetracker.apiUrl,
      headers: {
        "Content-Type": "application/json",
        "x-everit-api-key": config.timetracker.apiToken,
        "x-requested-by": "",
        "x-timezone": "America/Sao_Paulo",
      },
    });

    // Cache for worklog tags
    this.worklogTagsCache = null;

    // Initialize Jira client for fetching issue IDs
    this.jiraClient = new JiraClient();

    // Cache for issue key to ID mappings
    this.issueKeyToIdCache = new Map();
  }

  async getWorklogTags() {
    // Return cached tags if available
    if (this.worklogTagsCache) {
      return this.worklogTagsCache;
    }

    try {
      const response = await this.client.get("/tag");
      this.worklogTagsCache = response.data.worklogTags || [];
      return this.worklogTagsCache;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Failed to fetch worklog tags: ${error.response.status} - ${
            error.response.data.message || error.response.statusText
          }`
        );
      }
      throw error;
    }
  }

  async createWorkLog(workLogData) {
    try {
      const response = await this.client.post("/worklog", workLogData);
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Failed to create work log: ${error.response.status} - ${
            error.response.data.message || error.response.statusText
          }`
        );
      }
      throw error;
    }
  }

  async batchCreateWorkLogs(workLogs) {
    const results = {
      successful: [],
      failed: [],
    };

    for (const workLog of workLogs) {
      try {
        const result = await this.createWorkLog(workLog);

        results.successful.push({
          ...workLog,
          workLogId: result.id,
        });
      } catch (error) {
        results.failed.push({
          ...workLog,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Map Toggl tags to Timetracker worklog tag IDs
  async mapTagsToWorklogTagIds(togglTags = []) {
    if (togglTags.length === 0) {
      return [];
    }

    const worklogTags = await this.getWorklogTags();
    const tagMap = new Map();

    // Create a map of tag name to tag ID for quick lookup
    worklogTags.forEach((tag) => {
      tagMap.set(tag.name.toLowerCase(), tag.id);
    });

    // Map Toggl tags to worklog tag IDs
    const worklogTagIds = [];
    togglTags.forEach((tag) => {
      const tagId = tagMap.get(tag.toLowerCase());
      if (tagId) {
        worklogTagIds.push(tagId);
      }
    });

    return worklogTagIds;
  }

  // Fetch issue IDs from Jira for the given issue keys
  async fetchIssueIds(issueKeys) {
    if (issueKeys.length === 0) {
      return {};
    }

    // Filter out keys that are already cached
    const uncachedKeys = issueKeys.filter(
      (key) => !this.issueKeyToIdCache.has(key)
    );

    if (uncachedKeys.length > 0) {
      try {
        // Fetch issue IDs from Jira
        const issueKeyToIdMap = await this.jiraClient.bulkFetchIssueIds(
          uncachedKeys
        );

        // Cache the results
        Object.entries(issueKeyToIdMap).forEach(([key, id]) => {
          this.issueKeyToIdCache.set(key, id);
        });
      } catch (error) {
        console.warn(
          `Warning: Failed to fetch issue IDs from Jira: ${error.message}`
        );
        // Continue with cached values only
      }
    }

    // Return the mapping for all requested keys
    const result = {};
    issueKeys.forEach((key) => {
      if (this.issueKeyToIdCache.has(key)) {
        result[key] = this.issueKeyToIdCache.get(key);
      }
    });

    return result;
  }

  async prefetchIssueIds(parsedEntries) {
    const issueKeys = new Set();
    parsedEntries.forEach((entry) => {
      if (entry.issueKey) {
        issueKeys.add(entry.issueKey);
      }
    });

    if (issueKeys.size > 0) {
      await this.fetchIssueIds(Array.from(issueKeys));
    }
  }

  async convertParsedEntryToWorklog(parsedEntry) {
    const worklogTagIds = await this.mapTagsToWorklogTagIds(parsedEntry.tags);

    let issueId = null;
    if (parsedEntry.issueKey) {
      issueId = this.issueKeyToIdCache.get(parsedEntry.issueKey) || null;
    }

    return formatTimetrackerWorklog(parsedEntry, worklogTagIds, issueId);
  }
}
