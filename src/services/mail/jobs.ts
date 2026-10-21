import { registerJob } from "../jobs/queue.js";
import { JOB_EMAIL_SEND } from "./constants.js";
import { handleEmailSend } from "./outbound.js";

export function registerMailJobs(): void {
  registerJob(
    {
      name: JOB_EMAIL_SEND,
      label: "Outbound email",
      retryLimit: 3,
      retryDelaySeconds: 30,
      retryBackoff: true,
      concurrency: 1,
      policy: "standard",
      expireInSeconds: 5 * 60,
      cron: null,
      includeMetadata: true,
    },
    (data, job) => handleEmailSend(data, job),
  );
}
