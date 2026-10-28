/**
 * dsh-nudge — Host half.
 *
 * The feature is entirely browser-side: the floating window asks the agent for
 * a short status report with one chosen prompt, and the answer lands in the
 * conversation. This module exists so the Loader has a real Host entry to mount
 * for the `nudge` row; the mounted row is what makes the client bundle part of
 * the boot graph.
 *
 * No configuration, no imports: the probe presets, the delivery default and the
 * window preferences all live in the browser half, where the user can change
 * them without restarting the Harness.
 *
 * @module dsh-nudge
 */

/** Loader-facing plugin name. Must equal the package name. */
export const name = 'dsh-nudge'

/** The Host half contributes no capability and requires no services. */
export const inject = []

/** Host activation. Intentionally empty. */
export function apply() {}
