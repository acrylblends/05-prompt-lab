/**
 * The app's name and the one place its mount prefix is named. The pages themselves are plugins (plugins/prompts, runs, evaluations, models), each with its
 * own row in blend.yaml; nothing here serves a route.
 *
 * On its own server (production, `npm start`) the app mounts at the root and its URLs are `/prompts`, `/prompts/:id`, `/runs/:id`, `/evaluations`,
 * `/settings/models`; when the ACRYL frame hosts it they mount under this prefix, and the frame opens its tile at `/app/`.
 * src/app.ts hands the prefix to the `lab-shell` row, and every page plugin mounts and links under `ctx.shell.prefix`.
 */
export const APP_NAME = 'prompt-lab'

export const FRAME_MOUNT_PREFIX = '/app'
