// Background tasks for the '{{name}}' app (Django's tasks.py). Each exported task is named '{{name}}.<export name>'.
// Enqueue one from anywhere with `await sendReport.enqueue(report.pk)`; arguments must be JSON.
//
// import { task } from '@ghuri/tasks'
//
// export const sendReport = task(
//   async (reportId: number) => {
//     // …
//     return { sent: true }
//   },
//   { maxAttempts: 3 },
// )

export {}
