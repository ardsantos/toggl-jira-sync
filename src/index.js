#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import dayjs from "dayjs";
import inquirer from "inquirer";
import Table from "cli-table3";

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { config, validateConfig } from "./config.js";
import { TogglClient } from "./api/toggl.js";
import { JiraClient } from "./api/jira.js";
import { TimetrackerClient } from "./api/timetracker.js";
import { parseDateInput } from "./utils/dateParser.js";
import {
  parseTimeEntry,
  groupEntriesByDescription,
  groupEntriesByIssueKeyAndDate,
} from "./utils/parser.js";
import { prepareSummaryData, formatDuration, formatJiraWorkLogWithBreakdown } from "./utils/formatter.js";
import { SyncHistory } from "./utils/syncHistory.js";
import {
  promptForJiraAssignment,
  convertUnassignedToJiraEntries,
} from "./utils/interactive.js";
import { findGroupByWorkLog } from "./utils/entry-helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
);

async function displaySummary(summary) {
  console.log("\n" + chalk.bold("=== SUMMARY ==="));

  // Display already synced entries
  if (summary.alreadySynced && summary.alreadySynced.length > 0) {
    console.log("\n" + chalk.gray.bold("Already synced entries (ignored):"));
    const syncedTable = new Table({
      head: ["Issue Key", "Time", "Description", "Entries"],
      colWidths: [15, 10, 50, 10],
    });

    summary.alreadySynced.forEach((item) => {
      syncedTable.push([
        item.issueKey,
        item.timeFormatted,
        item.description.substring(0, 47) +
          (item.description.length > 47 ? "..." : ""),
        item.entryCount,
      ]);
    });

    console.log(syncedTable.toString());
  }

  // Display Jira work logs
  if (summary.jiraWorkLogs.length > 0) {
    console.log("\n" + chalk.green.bold("Work logs to be created:"));
    const jiraTable = new Table({
      head: ["Issue Key", "Date", "Time", "Entries", "Tags", "Preview"],
      colWidths: [12, 12, 10, 10, 30],
    });

    summary.jiraWorkLogs.forEach((log) => {
      const preview =
        log.timeBreakdown && log.timeBreakdown.length > 0
          ? `${log.timeBreakdown[0].timeRange} (${log.timeBreakdown[0].duration})`
          : log.comment.substring(0, 27);
      const moreText = log.entryCount > 1 ? ` +${log.entryCount - 1} more` : "";

      // Get tags from the first entry in this group
      let tagsText = "";
      if (log.entries && log.entries.length > 0 && log.entries[0].tags) {
        tagsText = log.entries[0].tags.slice(0, 2).join(", ");
        if (log.entries[0].tags.length > 2) {
          tagsText += ` +${log.entries[0].tags.length - 2}`;
        }
      }

      jiraTable.push([
        log.issueKey,
        log.date || dayjs(log.startedAt).format("YYYY-MM-DD"),
        log.timeSpentFormatted,
        log.entryCount,
        tagsText,
        preview + moreText,
      ]);
    });

    console.log(jiraTable.toString());
  }

  // Display entries without tags
  if (summary.entriesWithoutTags && summary.entriesWithoutTags.length > 0) {
    console.log(
      "\n" + chalk.red.bold("Time entries without tags (will be ignored):")
    );
    const noTagsTable = new Table({
      head: ["Description", "Total Time", "Entries"],
      colWidths: [60, 15, 10],
    });

    summary.entriesWithoutTags.forEach((entry) => {
      noTagsTable.push([
        entry.description.substring(0, 57) +
          (entry.description.length > 57 ? "..." : ""),
        entry.totalTime,
        entry.entryCount,
      ]);
    });

    console.log(noTagsTable.toString());
  }

  // Display non-Jira entries
  if (summary.nonJiraEntries.length > 0) {
    console.log(
      "\n" + chalk.yellow.bold("Time entries without Jira issue keys:")
    );
    const nonJiraTable = new Table({
      head: ["Description", "Total Time", "Entries"],
      colWidths: [60, 15, 10],
    });

    summary.nonJiraEntries.forEach((entry) => {
      nonJiraTable.push([
        entry.description.substring(0, 57) +
          (entry.description.length > 57 ? "..." : ""),
        entry.totalTime,
        entry.entryCount,
      ]);
    });

    console.log(nonJiraTable.toString());
  }

  // Display totals
  console.log("\n" + chalk.bold("Totals:"));
  if (summary.totals.alreadySyncedTime) {
    console.log(
      `  Already synced: ${chalk.gray(summary.totals.alreadySyncedTime)}`
    );
  }
  console.log(`  Jira time (new): ${chalk.green(summary.totals.jiraTime)}`);
  console.log(`  Non-Jira time: ${chalk.yellow(summary.totals.nonJiraTime)}`);
  console.log(`  Total time: ${chalk.cyan(summary.totals.totalTime)}`);
}

async function syncCommand(options) {
  try {
    let startDate, endDate;

    try {
      startDate = parseDateInput(options.from);
      endDate = parseDateInput(options.to);
    } catch (error) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }

    const useJira = options.jira || false;
    const mode = useJira ? "jira" : "timetracker";

    validateConfig(mode);

    if (!startDate.isValid() || !endDate.isValid()) {
      console.error(
        chalk.red("Invalid date format. Please use YYYY-MM-DD format or number of days ago (e.g., 7).")
      );
      process.exit(1);
    }

    console.log(
      chalk.cyan(
        `Fetching time entries from ${startDate.format(
          "YYYY-MM-DD"
        )} to ${endDate.format("YYYY-MM-DD")}...`
      )
    );

    // Fetch entries from Toggl
    const togglClient = new TogglClient();
    const timeEntries = await togglClient.getTimeEntries(startDate, endDate);

    if (timeEntries.length === 0) {
      console.log(
        chalk.yellow("No time entries found for the specified period.")
      );
      return;
    }

    console.log(chalk.green(`Found ${timeEntries.length} time entries.`));
    console.log(chalk.blue(`Using ${mode} mode for sync.`));

    // Initialize sync history
    const syncHistory = new SyncHistory();

    // Parse entries
    const parsedEntries = timeEntries.map(parseTimeEntry);

    // Filter out already synced entries
    const { synced: alreadySyncedEntries, unsynced: unsyncedEntries } =
      syncHistory.filterUnsyncedEntries(parsedEntries);

    if (alreadySyncedEntries.length > 0) {
      console.log(
        chalk.gray(
          `${alreadySyncedEntries.length} entries already synced and will be ignored.`
        )
      );
    }

    // Separate unsynced entries
    const jiraEntries = unsyncedEntries.filter((e) => e.hasJiraIssue);
    const nonJiraEntries = unsyncedEntries.filter((e) => !e.hasJiraIssue);
    const entriesWithoutTags = unsyncedEntries.filter((e) => !e.hasTags);

    const groupedJiraEntries = groupEntriesByIssueKeyAndDate(jiraEntries);
    const groupedNonJiraEntries = groupEntriesByDescription(nonJiraEntries);
    const groupedEntriesWithoutTags =
      groupEntriesByDescription(entriesWithoutTags);
    const groupedAlreadySynced =
      syncHistory.groupSyncedEntriesByIssue(alreadySyncedEntries);

    // Prepare summary
    let summary = prepareSummaryData(
      groupedJiraEntries,
      groupedNonJiraEntries,
      groupedEntriesWithoutTags,
      groupedAlreadySynced
    );

    // Log entries without tags
    if (entriesWithoutTags.length > 0) {
      console.log(
        chalk.red(
          `${entriesWithoutTags.length} time entries without tags will be ignored.`
        )
      );
    }

    // Display summary
    await displaySummary(summary);

    // Initialize appropriate client based on mode
    let client;
    if (useJira) {
      // Check if Jira config is available
      if (!config.jira.apiToken || !config.jira.email || !config.jira.domain) {
        console.error(
          chalk.red(
            "Jira configuration is missing. Please set JIRA_API_TOKEN, JIRA_EMAIL, and JIRA_DOMAIN."
          )
        );
        process.exit(1);
      }
      client = new JiraClient();
    } else {
      client = new TimetrackerClient();
    }

    // Handle unassigned entries if any exist (only for Jira mode)
    if (useJira && groupedNonJiraEntries.length > 0 && !options.dryRun) {
      // Prompt for assignments
      const assignments = await promptForJiraAssignment(
        groupedNonJiraEntries,
        client
      );

      if (assignments.length > 0) {
        // Convert assignments to Jira entries and merge with existing
        const assignedJiraEntries = convertUnassignedToJiraEntries(assignments);
        Object.assign(groupedJiraEntries, assignedJiraEntries);

        // Recalculate summary with newly assigned entries
        summary = prepareSummaryData(
          groupedJiraEntries,
          [],
          groupedAlreadySynced
        );

        // Display updated summary
        console.log("\n" + chalk.bold("=== UPDATED SUMMARY ==="));
        await displaySummary(summary);
      }
    }

    if (summary.jiraWorkLogs.length === 0) {
      console.log(
        `\n${chalk.yellow(`No ${mode.toLowerCase()} work logs to create.`)}`
      );
      return;
    }

    if (options.dryRun) {
      console.log(
        "\n" + chalk.yellow("Dry run mode - no work logs will be created.")
      );
      return;
    }

    // Ask for confirmation
    const workLogCount = useJira
      ? summary.jiraWorkLogs.length
      : summary.jiraWorkLogs.reduce((sum, log) => sum + log.entryCount, 0);

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: `Create ${workLogCount} work log(s) in ${mode}?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.yellow("Sync cancelled."));
      return;
    }

    console.log(`\n${chalk.cyan(`Creating work logs in ${mode}...`)}`);

    let results;
    let allParsedEntries = [];

    if (useJira) {
      const jiraWorklogs = summary.jiraWorkLogs.map(worklog =>
        formatJiraWorkLogWithBreakdown(worklog.issueKey, worklog.entries, worklog.date)
      );
      results = await client.batchCreateWorkLogs(jiraWorklogs);
    } else {
      for (const workLog of summary.jiraWorkLogs) {
        allParsedEntries.push(...workLog.entries);
      }

      await client.prefetchIssueIds(allParsedEntries);

      const timetrackerWorkLogs = [];
      for (const entry of allParsedEntries) {
        const timetrackerWorkLog = await client.convertParsedEntryToWorklog(entry);
        timetrackerWorkLogs.push(timetrackerWorkLog);
      }
      results = await client.batchCreateWorkLogs(timetrackerWorkLogs);
    }

    // Display results
    if (results.successful.length > 0) {
      console.log(
        chalk.green(
          `✓ Successfully created ${results.successful.length} work log(s).`
        )
      );

      if (useJira) {
        results.successful.forEach((workLog) => {
          const groupKey = findGroupByWorkLog(groupedJiraEntries, workLog);

          if (groupKey && groupedJiraEntries[groupKey]) {
            syncHistory.markEntriesAsSynced(
              groupedJiraEntries[groupKey].entries,
              workLog.issueKey,
              workLog.workLogId
            );
          }
        });
      } else {
        results.successful.forEach((workLog, index) => {
          if (allParsedEntries[index]) {
            const entry = allParsedEntries[index];
            syncHistory.markEntriesAsSynced(
              [entry],
              entry.issueKey || 'NO_ISSUE',
              workLog.workLogId
            );
          }
        });
      }

      console.log(chalk.gray("Sync history updated."));
    }

    if (results.failed.length > 0) {
      console.log(
        chalk.red(`✗ Failed to create ${results.failed.length} work log(s):`)
      );
      results.failed.forEach((failure) => {
        console.log(chalk.red(`  - ${failure.issueKey}: ${failure.error}`));
      });
    }
  } catch (error) {
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  }
}

async function configCommand() {
  console.log(chalk.cyan("Current configuration:"));
  console.log("\nToggl:");
  console.log(
    `  API Token: ${
      config.toggl.apiToken
        ? "***" + config.toggl.apiToken.slice(-4)
        : "Not set"
    }`
  );
  console.log(`  Workspace ID: ${config.toggl.workspaceId || "Not set"}`);
  console.log(`  Project ID: ${config.toggl.projectId || "Not set"}`);
  console.log("\nTimetracker:");
  console.log(
    `  API Token: ${
      config.timetracker.apiToken
        ? "***" + config.timetracker.apiToken.slice(-4)
        : "Not set"
    }`
  );
  console.log("\nJira:");
  console.log(
    `  API Token: ${
      config.jira.apiToken ? "***" + config.jira.apiToken.slice(-4) : "Not set"
    }`
  );
  console.log(`  Email: ${config.jira.email || "Not set"}`);
  console.log(`  Domain: ${config.jira.domain || "Not set"}`);

  console.log("\n" + chalk.yellow("Configuration methods:"));
  console.log("1. Create a .env file in your current directory");
  console.log("2. Set environment variables directly");

  const envExamplePath = join(process.cwd(), ".env.example");
  const hasEnvExample = existsSync(envExamplePath);

  if (!hasEnvExample && existsSync(join(process.cwd(), ".env"))) {
    console.log("\n" + chalk.green("✓ .env file found in current directory"));
  } else if (!existsSync(join(process.cwd(), ".env"))) {
    console.log(
      "\n" + chalk.yellow("No .env file found in current directory.")
    );
    console.log("Create one with the following content:");
    console.log(
      chalk.gray(`
# Toggl Configuration
TOGGL_API_TOKEN=your_toggl_api_token_here
TOGGL_WORKSPACE_ID=your_workspace_id_here
TOGGL_PROJECT_ID=your_project_id_here

# Jira Configuration
JIRA_API_TOKEN=your_jira_api_token_here
JIRA_EMAIL=your_email@company.com
JIRA_DOMAIN=yourcompany.atlassian.net

# Timetracker Configuration
TIMETRACKER_JIRA_API_TOKEN=your_timetracker_api_token_here`)
    );
  }
}

async function historyViewCommand() {
  const syncHistory = new SyncHistory();
  const stats = syncHistory.getStats();

  if (stats.totalEntries === 0) {
    console.log(chalk.yellow("No sync history found."));
    return;
  }

  console.log(chalk.cyan("Sync History Statistics:"));
  console.log(`  Total synced entries: ${stats.totalEntries}`);
  console.log(`  Total synced time: ${formatDuration(stats.totalSeconds)}`);
  console.log(`  Unique Jira issues: ${stats.uniqueIssues}`);

  if (stats.issues.length > 0) {
    console.log("\n" + chalk.cyan("Synced issues:"));
    stats.issues.forEach((issue) => {
      console.log(`  - ${issue}`);
    });
  }
}

async function historyClearCommand() {
  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message:
        "Are you sure you want to clear all sync history? This cannot be undone.",
      default: false,
    },
  ]);

  if (confirmed) {
    const syncHistory = new SyncHistory();
    syncHistory.clear();
    console.log(chalk.green("Sync history cleared."));
  } else {
    console.log(chalk.yellow("Clear cancelled."));
  }
}

// Set up CLI
program
  .name("toggl-jira")
  .description(
    "Sync time entries from Toggl Track to Timetracker or Jira work logs"
  )
  .version(packageJson.version);

program
  .command("sync")
  .description("Sync time entries to Timetracker (default) or Jira")
  .option(
    "-f, --from <date>",
    "Start date (YYYY-MM-DD or days ago, e.g., 7)",
    dayjs().format("YYYY-MM-DD")
  )
  .option(
    "-t, --to <date>",
    "End date (YYYY-MM-DD or days ago, e.g., 3)",
    dayjs().format("YYYY-MM-DD")
  )
  .option(
    "-d, --dry-run",
    "Show what would be synced without creating work logs"
  )
  .option(
    "-j, --jira",
    "Use Jira API instead of Timetracker (default: Timetracker)"
  )
  .action(syncCommand);

program
  .command("config")
  .description("Show current configuration")
  .action(configCommand);

program
  .command("history:view")
  .description("View sync history statistics")
  .action(historyViewCommand);

program
  .command("history:clear")
  .description("Clear all sync history")
  .action(historyClearCommand);

program.parse();
